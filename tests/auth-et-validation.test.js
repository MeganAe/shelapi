import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { KEY, rawRequest, startUpstream, withGateway } from "./_helpers.js";

const up = await startUpstream();
after(() => up.close());
const run = (opts, fn) => withGateway(up, opts, fn);

// ---------------------------------------------------------------- Authentification
test("401 missing_api_key sans en-tête, avec WWW-Authenticate et request_id cohérent", () =>
  run({}, async (gw) => {
    const r = await gw.api("/v1/models", { key: null });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "missing_api_key");
    assert.equal(r.json.error.type, "authentication_error");
    assert.match(r.headers.get("www-authenticate"), /^Bearer/);
    assert.equal(r.json.error.request_id, r.headers.get("x-request-id"));
  }));

test("401 invalid_api_key avec une mauvaise clé (même préfixe, même longueur)", () =>
  run({}, async (gw) => {
    const r = await gw.api("/v1/models", { key: KEY.slice(0, -1) + "X" });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "invalid_api_key");
  }));

test("accepte Bearer (insensible à la casse) et X-Api-Key, plusieurs clés possibles", () =>
  run({ env: { GATEWAY_KEYS: `${KEY}, autre-cle-projet-123456` } }, async (gw) => {
    assert.equal((await gw.api("/v1/models", { key: null, headers: { Authorization: `bearer ${KEY}` } })).status, 200);
    assert.equal((await gw.api("/v1/models", { key: null, headers: { "X-Api-Key": "autre-cle-projet-123456" } })).status, 200);
    assert.equal((await gw.api("/v1/models", { key: "autre-cle-projet-123456" })).status, 200);
  }));

test("503 server_misconfigured si GATEWAY_KEYS est vide (et non un 401 trompeur)", () =>
  run({ env: { GATEWAY_KEYS: "" } }, async (gw) => {
    const r = await gw.api("/v1/models");
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, "server_misconfigured");
  }));

// ---------------------------------------------------------------- Validation du corps
test("400 invalid_json : texte, tableau, valeur seule, corps vide", () =>
  run({}, async (gw) => {
    for (const rawBody of ["pas du json", "[]", "42", '"texte"', "null", ""]) {
      const r = await gw.api("/v1/chat/completions", { method: "POST", rawBody });
      assert.equal(r.status, 400, `corps : ${JSON.stringify(rawBody)}`);
      assert.equal(r.json.error.code, "invalid_json");
    }
    assert.equal(up.calls.length, 0, "aucun fournisseur dérangé");
  }));

test("400 invalid_request : messages absent / vide / mal formé, model et stream mal typés", () =>
  run({}, async (gw) => {
    const cases = [
      [{}, "messages"],
      [{ messages: [] }, "messages"],
      [{ messages: "salut" }, "messages"],
      [{ messages: [{ content: "sans rôle" }] }, "messages[0]"],
      [{ messages: [{ role: "user", content: "ok" }, null] }, "messages[1]"],
      [{ messages: [{ role: "user" }], model: 42 }, "model"],
      [{ messages: [{ role: "user" }], stream: "true" }, "stream"],
    ];
    for (const [body, param] of cases) {
      const r = await gw.chat(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "invalid_request");
      assert.equal(r.json.error.param, param);
    }
    assert.equal(up.calls.length, 0);
  }));

test("413 payload_too_large : taille annoncée (Content-Length) ou flux sans Content-Length", () =>
  run({ env: { MAX_BODY_BYTES: "2048" } }, async (gw) => {
    const big = { messages: [{ role: "user", content: "x".repeat(5000) }] };
    const a = await gw.chat(big);
    assert.equal(a.status, 413);
    assert.equal(a.json.error.code, "payload_too_large");

    const body = JSON.stringify(big);
    const b = await rawRequest(gw.url, {
      path: "/v1/chat/completions",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Transfer-Encoding": "chunked" },
      chunks: [body.slice(0, 1500), body.slice(1500, 3000), body.slice(3000)],
    });
    assert.equal(b.status, 413);
    assert.equal(JSON.parse(b.text).error.code, "payload_too_large");
    assert.equal(up.calls.length, 0);
  }));

test("les accents coupés entre deux paquets TCP arrivent intacts chez le fournisseur", () =>
  run({}, async (gw) => {
    const full = Buffer.from(JSON.stringify({ messages: [{ role: "user", content: "Déjà vu : ça va très bien, œuvre ✓ 😀" }] }));
    const cut = full.indexOf(Buffer.from("é")) + 1; // au milieu des 2 octets de « é »
    const cut2 = full.indexOf(Buffer.from("😀")) + 2; // et au milieu d'un emoji (4 octets)
    const r = await rawRequest(gw.url, {
      path: "/v1/chat/completions",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      chunks: [full.subarray(0, cut), full.subarray(cut, cut2), full.subarray(cut2)],
    });
    assert.equal(r.status, 200);
    assert.equal(up.chatCalls("groq")[0].body.messages[0].content, "Déjà vu : ça va très bien, œuvre ✓ 😀");
  }));

// ---------------------------------------------------------------- Mode Vercel (req.body déjà analysé)
async function vercelStyle(gw, rawBody) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    // Comme @vercel/node : req.body est une propriété paresseuse qui lève une erreur si le JSON est invalide.
    Object.defineProperty(req, "body", {
      get() {
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("Invalid JSON");
        }
      },
    });
    gw.handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: rawBody,
    });
    return { status: res.status, json: await res.json() };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("mode Vercel : req.body déjà analysé → réponse normale", () =>
  run({}, async (gw) => {
    const r = await vercelStyle(gw, JSON.stringify({ messages: [{ role: "user", content: "Salut é" }] }));
    assert.equal(r.status, 200);
    assert.equal(up.chatCalls("groq")[0].body.messages[0].content, "Salut é");
  }));

test("mode Vercel : le getter req.body qui lève une erreur donne un 400 propre, sans plantage", () =>
  run({}, async (gw) => {
    const r = await vercelStyle(gw, "{ceci n'est pas du json");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "invalid_json");
  }));
