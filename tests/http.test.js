import assert from "node:assert/strict";
import { after, test } from "node:test";
import { VERSION } from "../src/version.js";
import { startUpstream, withGateway, KEY } from "./_helpers.js";

const up = await startUpstream();
after(() => up.close());
const run = (opts, fn) => withGateway(up, opts, fn);

// ---------------------------------------------------------------- Routes publiques
test("GET / sans clé : statut minimal, sans révéler les fournisseurs configurés", () =>
  run({}, async (gw) => {
    const r = await gw.api("/", { key: null });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ["docs", "service", "status", "version"]);
    assert.equal(r.json.version, VERSION);
    assert.equal(r.json.docs, `${gw.url}/docs/`);
    assert.equal(r.headers.get("vary"), "Accept");
  }));

test("GET / avec une clé valide : ajoute la liste des fournisseurs actifs", () =>
  run({ env: { GEMINI_API_KEY: undefined } }, async (gw) => {
    const r = await gw.api("/");
    assert.deepEqual(r.json.providers, ["groq", "cloudflare"]);
  }));

test("GET / depuis un navigateur (Accept: text/html) : redirige vers /docs/ ; /docs aussi", () =>
  run({}, async (gw) => {
    const r = await gw.api("/", { key: null, headers: { Accept: "text/html,application/xhtml+xml" } });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/docs/");
    const d = await gw.api("/docs", { key: null });
    assert.equal(d.status, 302);
    assert.equal(d.headers.get("location"), "/docs/");
  }));

test("GET /health : sans clé, avec version et durée de fonctionnement, non journalisé", () =>
  run({}, async (gw) => {
    const r = await gw.api("/health", { key: null });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "ok");
    assert.equal(r.json.version, VERSION);
    assert.ok(Number.isInteger(r.json.uptime_s));
    assert.ok(!gw.log.lines.some((l) => l.includes("/health")), "les sondes ne polluent pas les journaux");
  }));

test("HEAD /health : 200 sans corps ; HEAD /v1/models → 405", () =>
  run({}, async (gw) => {
    const res = await fetch(`${gw.url}/health`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "");
    const models = await fetch(`${gw.url}/v1/models`, { method: "HEAD", headers: { Authorization: `Bearer ${KEY}` } });
    assert.equal(models.status, 405);
  }));

// ---------------------------------------------------------------- 404 / 405
test("route inconnue : 404 JSON ; mauvaise méthode : 405 avec Allow", () =>
  run({}, async (gw) => {
    const nf = await gw.api("/nimporte/quoi", { key: null });
    assert.equal(nf.status, 404);
    assert.equal(nf.json.error.code, "not_found");

    const bad = await gw.api("/v1/chat/completions", { method: "GET" });
    assert.equal(bad.status, 405);
    assert.equal(bad.headers.get("allow"), "POST, OPTIONS");
    assert.equal(bad.json.error.code, "method_not_allowed");

    assert.equal((await gw.api("/health", { method: "DELETE", key: null })).headers.get("allow"), "GET, HEAD, OPTIONS");
  }));

test("la barre finale est tolérée (/v1/models/), pas de fuite de la query string dans les journaux", () =>
  run({}, async (gw) => {
    const r = await gw.api("/v1/models/?token=secret123");
    assert.equal(r.status, 200);
    assert.ok(!gw.log.lines.join("\n").includes("secret123"));
  }));

test("les journaux ne contiennent jamais de secret : ni clés (passerelle, fournisseurs, tentative ratée), ni contenu des messages", () =>
  run({}, async (gw) => {
    const confidentiel = "phrase-confidentielle-4242";
    up.on("groq", "chat", { status: 429, headers: { "Retry-After": "30" }, json: { error: { message: "limite gsk_abcdef1234567890 atteinte" } } });
    up.on("gemini", "chat", { status: 500, json: { error: { message: "panne avec la clé AIzaSyABCDEFGH1234567" } } });
    const body = { messages: [{ role: "user", content: confidentiel }] };
    await gw.chat(body); // échecs chez Groq et Gemini, réponse de Cloudflare
    await gw.chat({ ...body, stream: true });
    await gw.api("/v1/chat/completions", { method: "POST", body, key: "mauvaise-cle-secrete-9999" });
    await gw.api("/v1/chat/completions", { method: "POST", rawBody: `{"messages": [{"role": "user", "content": "${confidentiel}"` }); // JSON tronqué
    await gw.api("/groq/model-a?api_key=dans-la-query-777", { method: "POST", body });

    const journal = gw.log.lines.join("\n");
    assert.ok(journal.length > 100, "le journal ne doit pas être vide : le test serait sans valeur");
    for (const secret of [KEY, "groq-secret", "gemini-secret", "cf-secret", "mauvaise-cle-secrete-9999", confidentiel, "dans-la-query-777", "gsk_abcdef1234567890", "AIzaSyABCDEFGH1234567", "Bearer "]) {
      assert.ok(!journal.includes(secret), `« ${secret} » ne doit jamais apparaître dans les journaux`);
    }
  }));

test("URL étranges (//, %, très longue, caractères de contrôle) : jamais de plantage", () =>
  run({}, async (gw) => {
    for (const path of ["//", "/%", "/%zz", `/${"a".repeat(8000)}`, "/v1//models", "/..%2f..%2fetc/passwd"]) {
      const r = await gw.api(path, { key: null });
      assert.ok([200, 400, 401, 404, 414].includes(r.status), `${path.slice(0, 20)} → ${r.status}`);
    }
    assert.equal((await gw.api("/health", { key: null })).status, 200);
  }));

// ---------------------------------------------------------------- X-Request-Id
test("X-Request-Id : repris s'il est valide, remplacé sinon", () =>
  run({}, async (gw) => {
    const ok = await gw.api("/health", { key: null, headers: { "X-Request-Id": "abc-123_XYZ" } });
    assert.equal(ok.headers.get("x-request-id"), "abc-123_XYZ");
    const bad = await gw.api("/health", { key: null, headers: { "X-Request-Id": "x".repeat(200) } });
    assert.match(bad.headers.get("x-request-id"), /^req_[a-z0-9]+$/);
    const injected = await gw.api("/health", { key: null, headers: { "X-Request-Id": "a b<script>" } });
    assert.match(injected.headers.get("x-request-id"), /^req_/);
  }));

// ---------------------------------------------------------------- CORS
test("CORS par défaut (*) : préflight 204 complet et en-têtes exposés sur les réponses", () =>
  run({}, async (gw) => {
    const pre = await gw.api("/v1/chat/completions", {
      method: "OPTIONS",
      key: null,
      headers: { Origin: "https://app.exemple.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    assert.match(pre.headers.get("access-control-allow-headers"), /authorization/i);
    assert.match(pre.headers.get("access-control-allow-methods"), /POST/);

    const res = await gw.api("/v1/models", { headers: { Origin: "https://app.exemple.com" } });
    const exposed = res.headers.get("access-control-expose-headers").toLowerCase();
    for (const h of ["x-request-id", "x-provider", "x-model", "retry-after"]) assert.ok(exposed.includes(h), h);
  }));

test("CORS restreint (CORS_ORIGINS) : seule une origine listée est autorisée, avec Vary: Origin", () =>
  run({ env: { CORS_ORIGINS: "https://a.example, https://b.example" } }, async (gw) => {
    const allowed = await gw.api("/health", { key: null, headers: { Origin: "https://b.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://b.example");
    assert.match(allowed.headers.get("vary"), /Origin/);

    const denied = await gw.api("/health", { key: null, headers: { Origin: "https://evil.example" } });
    assert.equal(denied.headers.get("access-control-allow-origin"), null);

    const none = await gw.api("/health", { key: null });
    assert.equal(none.headers.get("access-control-allow-origin"), null);
  }));

test("les erreurs portent aussi les en-têtes CORS (le navigateur peut lire le message)", () =>
  run({}, async (gw) => {
    const r = await gw.api("/v1/models", { key: null, headers: { Origin: "https://app.exemple.com" } });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  }));
