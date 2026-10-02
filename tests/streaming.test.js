import assert from "node:assert/strict";
import { after, test } from "node:test";
import { KEY, delta, sleep, startUpstream, withGateway } from "./_helpers.js";

const up = await startUpstream();
after(() => up.close());
const run = (opts, fn) => withGateway(up, opts, fn);

const DONE = "data: [DONE]\n\n";
const stream = (gw, extra = {}) =>
  fetch(`${gw.url}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...gw.hi, stream: true, ...extra }),
  });

test("le flux SSE est relayé tel quel, avec les en-têtes X-Provider / X-Model", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", { stream: [delta("Bon"), delta("jour"), DONE] });
    const res = await stream(gw);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^text\/event-stream/);
    assert.equal(res.headers.get("x-provider"), "groq");
    assert.equal(res.headers.get("x-model"), "model-a");
    const text = await res.text();
    assert.ok(text.includes('"content":"Bon"') && text.includes('"content":"jour"') && text.endsWith(DONE), text);
  }));

test("la bascule fonctionne AVANT le début du flux (429 puis streaming chez le suivant)", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", { status: 429, headers: { "retry-after": "20" }, json: { error: { message: "limit" } } });
    up.on("gemini", "chat", { stream: [delta("ok"), DONE] });
    const res = await stream(gw);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-provider"), "gemini");
    assert.ok((await res.text()).includes('"content":"ok"'));
  }));

test("fournisseur coupé en plein flux → événement SSE d'erreur propre, flux terminé, serveur toujours vivant", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", { stream: [delta("Bon")], end: "destroy" });
    const res = await stream(gw);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('"content":"Bon"'));
    const errorEvent = text.split("\n\n").map((e) => e.replace(/^data: /, "")).filter((e) => e.startsWith('{"error"')).map((e) => JSON.parse(e))[0];
    assert.equal(errorEvent.error.code, "upstream_error");
    assert.match(errorEvent.error.request_id, /^req_/);

    up.reset();
    assert.equal((await gw.chat(gw.hi)).status, 200, "le serveur continue de répondre");
  }));

test("si le client ferme la connexion pendant le flux, l'appel au fournisseur est annulé", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", { stream: [delta("a"), { wait: 5000 }, delta("b")], end: "hang" });
    const ctrl = new AbortController();
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...gw.hi, stream: true }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.ok(new TextDecoder().decode(first.value).includes('"content":"a"'));
    ctrl.abort();
    await reader.read().catch(() => {});
    for (let i = 0; i < 20 && !up.chatCalls("groq")[0].aborted; i++) await sleep(50);
    assert.equal(up.chatCalls("groq")[0].aborted, true, "l'appel au fournisseur a été interrompu (plus de tokens gaspillés)");
  }));

test("TIMEOUT_MS ne coupe PAS un flux déjà commencé (il ne couvre que l'attente des en-têtes)", () =>
  run({ env: { TIMEOUT_MS: "500" } }, async (gw) => {
    up.on("groq", "chat", { stream: [delta("a"), { wait: 1000 }, delta("b"), DONE] });
    const text = await (await stream(gw)).text();
    assert.ok(text.includes('"content":"a"') && text.includes('"content":"b"') && text.endsWith(DONE), text);
    assert.ok(!text.includes('"error"'));
  }));

test("DEADLINE_MS coupe proprement un flux trop long (événement SSE deadline_exceeded)", () =>
  run({ env: { DEADLINE_MS: "1000" } }, async (gw) => {
    up.on("groq", "chat", { stream: [delta("a"), { wait: 4000 }, delta("b")], end: "hang" });
    const t0 = Date.now();
    const text = await (await stream(gw)).text();
    assert.ok(Date.now() - t0 < 2500);
    assert.ok(text.includes('"content":"a"'));
    assert.ok(text.includes('"code":"deadline_exceeded"'), text);
  }));
