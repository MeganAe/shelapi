import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fakeClock, sleep, startUpstream, withGateway } from "./_helpers.js";

const up = await startUpstream();
after(() => up.close());
const run = (opts, fn) => withGateway(up, opts, fn);

const rateLimited = (retryAfter) => ({ status: 429, headers: retryAfter ? { "retry-after": String(retryAfter) } : {}, json: { error: { message: "Rate limit reached" } } });
const failing = (status, message = "boom", code) => ({ status, json: { error: { message, ...(code ? { code } : {}) } } });

// ---------------------------------------------------------------- Routage
test("auto : premier modèle du premier fournisseur, avec X-Provider / X-Model et clé du fournisseur", () =>
  run({}, async (gw) => {
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-provider"), "groq");
    assert.equal(r.headers.get("x-model"), "model-a"); // GROQ_MODEL passe en premier
    assert.equal(r.json.choices[0].message.content, "echo:Bonjour");
    assert.equal(up.chatCalls("groq")[0].authorization, "Bearer groq-secret");
    assert.equal(up.chatCalls("groq")[0].body.model, "model-a");
    assert.match(gw.log.lines.at(-1), /^info \[req_\w+\] POST \/v1\/chat\/completions 200 \d+ms groq\/model-a clé=\w{6}$/);
  }));

test("« model » : alias inconnu = auto, fournisseur seul, modèle exact, fournisseur non configuré = auto", () =>
  run({}, async (gw) => {
    assert.equal((await gw.chat({ ...gw.hi, model: "gpt-4o" })).headers.get("x-model"), "model-a");

    const g = await gw.chat({ ...gw.hi, model: "gemini" });
    assert.equal(g.headers.get("x-provider"), "gemini");
    assert.equal(g.headers.get("x-model"), "gem-1");
    assert.equal(up.chatCalls("groq").length, 1, "groq non sollicité pour model=gemini");

    const cf = await gw.chat({ ...gw.hi, model: "cloudflare" });
    assert.equal(cf.headers.get("x-model"), "@cf/cf-1");

    const exact = await gw.chat({ ...gw.hi, model: "gemini/gem-2" });
    assert.equal(exact.headers.get("x-model"), "gem-2");

    const trailing = await gw.chat({ ...gw.hi, model: "gemini/" }); // « gemini/ » = le fournisseur
    assert.equal(trailing.headers.get("x-model"), "gem-1");
  }));

test("fournisseur non configuré demandé explicitement : on retombe sur auto", () =>
  run({ env: { CLOUDFLARE_API_TOKEN: undefined } }, async (gw) => {
    const r = await gw.chat({ ...gw.hi, model: "cloudflare" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-provider"), "groq");
  }));

test("GET /v1/models : auto + fournisseur/modèle ; les modèles non-chat et inactifs sont exclus", () =>
  run({}, async (gw) => {
    const r = await gw.api("/v1/models");
    const ids = r.json.data.map((m) => m.id);
    assert.deepEqual(ids, ["auto", "groq/model-a", "groq/model-b", "gemini/gem-1", "gemini/gem-2", "cloudflare/@cf/cf-1"]);
    assert.ok(r.json.data.every((m) => m.object === "model" && Number.isInteger(m.created) && m.owned_by));
  }));

// ---------------------------------------------------------------- Bascule et pauses
test("429 : bascule vers le fournisseur suivant, puis ignore les modèles en pause", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", rateLimited(30));
    const first = await gw.chat(gw.hi);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-provider"), "gemini");
    assert.equal(up.chatCalls("groq").length, 2, "les deux modèles Groq essayés une fois");

    const second = await gw.chat(gw.hi);
    assert.equal(second.headers.get("x-provider"), "gemini");
    assert.equal(up.chatCalls("groq").length, 2, "modèles en pause : aucun nouvel appel");
  }));

test("la pause expire : Retry-After respecté puis le modèle est réessayé", () => {
  const clock = fakeClock();
  return run({ now: clock.now }, async (gw) => {
    up.on("groq", "chat", [rateLimited(30), rateLimited(30), undefined]); // 3ᵉ appel : succès par défaut
    await gw.chat(gw.hi);
    clock.advance(29_000);
    await gw.chat(gw.hi);
    assert.equal(up.chatCalls("groq").length, 2, "29 s : encore en pause");
    clock.advance(2_000);
    const r = await gw.chat(gw.hi);
    assert.equal(up.chatCalls("groq").length, 3);
    assert.equal(r.headers.get("x-provider"), "groq");
  });
});

test("5xx : bascule + disjoncteur de 30 s (le fournisseur en panne n'est pas retenté à chaque requête)", () => {
  const clock = fakeClock();
  return run({ now: clock.now }, async (gw) => {
    up.on("groq", "chat", failing(503, "Service unavailable"));
    const r1 = await gw.chat(gw.hi);
    assert.equal(r1.headers.get("x-provider"), "gemini");
    const calls = up.chatCalls("groq").length;
    await gw.chat(gw.hi);
    assert.equal(up.chatCalls("groq").length, calls, "pas de nouvel appel pendant 30 s");
    clock.advance(31_000);
    await gw.chat(gw.hi);
    assert.ok(up.chatCalls("groq").length > calls, "retenté après 30 s");
  });
});

test("délai dépassé (TIMEOUT_MS) : bascule vers le suivant", () =>
  run({ env: { TIMEOUT_MS: "500" } }, async (gw) => {
    up.on("groq", "chat", { delayMs: 3000, json: {} });
    const t0 = Date.now();
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-provider"), "gemini");
    assert.ok(Date.now() - t0 < 2800, "ne doit pas attendre la fin du délai du fournisseur");
  }));

test("le délai couvre AUSSI la lecture du corps (en-têtes reçus, corps jamais terminé)", () =>
  run({ env: { TIMEOUT_MS: "500" } }, async (gw) => {
    up.on("groq", "chat", { stall: true });
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-provider"), "gemini");
  }));

test("réponse 200 qui n'est pas du JSON : considérée comme un échec, bascule", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", { text: "<html>Bad gateway</html>" });
    const r = await gw.chat(gw.hi);
    assert.equal(r.headers.get("x-provider"), "gemini");
  }));

test("modèle retiré (400 model_decommissioned) : bascule + pause longue de ce modèle", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", (call) => (call.body.model === "model-a" ? failing(400, "The model `model-a` has been decommissioned", "model_decommissioned") : undefined));
    const r = await gw.chat(gw.hi);
    assert.equal(r.headers.get("x-model"), "model-b");
    await gw.chat(gw.hi);
    assert.equal(up.chatCalls("groq").filter((c) => c.body.model === "model-a").length, 1, "model-a n'est plus réessayé");
  }));

// Corps d'erreur de Cloudflare Workers AI. Les deux premiers sont ceux relevés sur un déploiement réel le 2 octobre 2026
// (format « errors: [{ code, message }] », différent de celui de Groq et de Gemini) ; le troisième est un exemple de refus.
const cfNoSuchModel = { status: 400, json: { errors: [{ message: "AiError: No such model: No such model @cf/inexistant/modele-xyz or task (72ef7198-96cd-45f8-bbf2-16041bea5b80)", code: 5007 }], success: false, result: {}, messages: [] } };
const cfDeprecated = { status: 410, json: { errors: [{ message: "AiError: Model has been deprecated: @cf/meta/infire-llama-3.1-8b-instruct was deprecated on 2026-05-30. See the model catalog for alternatives (cbec94f7)", code: 5028 }], success: false, result: {}, messages: [] } };
const cfInvalidInput = { status: 400, json: { errors: [{ message: "AiError: Invalid input: messages must not be empty (4a1f)", code: 5006 }], success: false, result: {}, messages: [] } };

test("Cloudflare « No such model » (HTTP 400) : modèle introuvable (404), message lisible et non le JSON brut", () =>
  run({}, async (gw) => {
    up.on("cf", "chat", cfNoSuchModel);
    const r = await gw.chat({ ...gw.hi, model: "cloudflare/@cf/inexistant/modele-xyz" });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "model_not_found");
    assert.equal(r.json.error.details[0].kind, "model_unavailable");
    assert.match(r.json.error.details[0].message, /^AiError: No such model/);
  }));

test("Cloudflare « Model has been deprecated » (HTTP 410) : modèle introuvable, message lisible", () =>
  run({}, async (gw) => {
    up.on("cf", "chat", cfDeprecated);
    const r = await gw.chat({ ...gw.hi, model: "cloudflare/@cf/meta/llama-3.1-8b-instruct" });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "model_not_found");
    assert.match(r.json.error.details[0].message, /^AiError: Model has been deprecated/);
  }));

test("Cloudflare « No such model » en mode auto : bascule sur le modèle suivant, et pause longue du modèle introuvable", () =>
  run({ env: { GROQ_API_KEY: undefined, GEMINI_API_KEY: undefined, CLOUDFLARE_MODEL: "@cf/retire,@cf/bon" } }, async (gw) => {
    up.on("cf", "chat", (call) => (call.body.model === "@cf/retire" ? cfNoSuchModel : undefined));
    const first = await gw.chat(gw.hi);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-model"), "@cf/bon");
    await gw.chat(gw.hi);
    assert.equal(up.chatCalls("cf").filter((c) => c.body.model === "@cf/retire").length, 1, "@cf/retire n'est plus réessayé pendant la pause");
  }));

test("Cloudflare : un vrai refus de la requête reste un 400 upstream_rejected, avec le message de Cloudflare (pas du JSON brut)", () =>
  run({}, async (gw) => {
    up.on("cf", "chat", cfInvalidInput);
    const r = await gw.chat({ ...gw.hi, model: "cloudflare/@cf/cf-1" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "upstream_rejected");
    assert.match(r.json.error.message, /^cloudflare a refusé la requête : AiError: Invalid input/);
  }));

test("délai global (DEADLINE_MS) dépassé : 504 deadline_exceeded en JSON, pas une coupure brutale", () =>
  run({ env: { DEADLINE_MS: "1000", TIMEOUT_MS: "800" } }, async (gw) => {
    for (const p of ["groq", "gemini", "cf"]) up.on(p, "chat", { delayMs: 5000, json: {} });
    const t0 = Date.now();
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 504);
    assert.equal(r.json.error.code, "deadline_exceeded");
    assert.ok(Date.now() - t0 < 2500);
    assert.ok(Array.isArray(r.json.error.details) && r.json.error.details.length >= 1);
  }));

// ---------------------------------------------------------------- Choix du code d'erreur final
test("tous les modèles limités → 429 rate_limited + Retry-After = le plus court délai", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", rateLimited(30));
    up.on("gemini", "chat", rateLimited(12));
    up.on("cf", "chat", rateLimited());
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 429);
    assert.equal(r.json.error.code, "rate_limited");
    assert.equal(r.headers.get("retry-after"), "12");
    assert.equal(r.json.error.details.length, 5);
  }));

test("tous les modèles en pause → 429 immédiat, sans appeler les fournisseurs", () =>
  run({}, async (gw) => {
    for (const p of ["groq", "gemini", "cf"]) up.on(p, "chat", rateLimited(30));
    await gw.chat(gw.hi);
    const before = up.calls.length;
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 429);
    assert.match(r.json.error.message, /pause/);
    assert.equal(up.calls.length, before);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
  }));

test("échecs mélangés → 502 upstream_error avec le détail de chaque tentative", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", failing(500));
    up.on("gemini", "chat", rateLimited(5));
    up.on("cf", "chat", failing(502));
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "upstream_error");
    assert.deepEqual(
      r.json.error.details.map((d) => d.kind),
      ["server", "server", "rate_limit", "rate_limit", "server"],
    );
    assert.equal(r.json.error.details[0].provider, "groq");
  }));

test("requête refusée partout (400) → 400 upstream_rejected avec le message du fournisseur", () =>
  run({}, async (gw) => {
    for (const p of ["groq", "gemini", "cf"]) up.on(p, "chat", failing(400, "`temperature` must be <= 2"));
    const r = await gw.chat({ ...gw.hi, temperature: 9 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "upstream_rejected");
    assert.match(r.json.error.message, /temperature/);
  }));

test("un modèle en pause ne masque pas un vrai refus 400 des autres : la réponse reste un 400 upstream_rejected", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", rateLimited(60));
    await gw.chat(gw.hi); // groq/* part en pause, gemini répond
    for (const p of ["gemini", "cf"]) up.on(p, "chat", failing(400, "`max_tokens` is too large"));
    const r = await gw.chat({ ...gw.hi, max_tokens: 10 ** 9 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "upstream_rejected");
    assert.match(r.json.error.message, /max_tokens/);
  }));

test("modèle imposé (provider/modèle) : pas de bascule, et le statut est traduit correctement", () =>
  run({}, async (gw) => {
    const forced = { ...gw.hi, model: "groq/model-b" };

    up.on("groq", "chat", failing(401, "Invalid API Key"));
    let r = await gw.chat(forced);
    assert.equal(r.status, 502, "un 401 du fournisseur ne doit pas passer pour un 401 de la passerelle");
    assert.equal(r.json.error.code, "upstream_auth_error");

    up.on("groq", "chat", failing(404, "model not found"));
    r = await gw.chat(forced);
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "model_not_found");

    up.on("groq", "chat", rateLimited(7));
    r = await gw.chat(forced);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "7");

    up.on("groq", "chat", failing(500));
    r = await gw.chat(forced);
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "upstream_error");

    up.on("groq", "chat", failing(422, "bad body"));
    r = await gw.chat(forced);
    assert.equal(r.status, 422);
    assert.equal(r.json.error.code, "upstream_rejected");

    assert.ok(up.chatCalls("groq").every((c) => c.body.model === "model-b"), "uniquement model-b");
    assert.equal(up.chatCalls("gemini").length, 0, "aucune bascule");
  }));

test("modèle imposé qui ne répond pas à temps → 504 upstream_timeout", () =>
  run({ env: { TIMEOUT_MS: "500" } }, async (gw) => {
    up.on("groq", "chat", { delayMs: 2000, json: {} });
    const r = await gw.chat({ ...gw.hi, model: "groq/model-a" });
    assert.equal(r.status, 504);
    assert.equal(r.json.error.code, "upstream_timeout");
  }));

test("clé du fournisseur refusée partout → 502 upstream_auth_error (message pour l'administrateur)", () =>
  run({}, async (gw) => {
    for (const p of ["groq", "gemini", "cf"]) up.on(p, "chat", failing(401, "bad key"));
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "upstream_auth_error");
  }));

// ---------------------------------------------------------------- Détails des erreurs fournisseurs
test("les clés et identifiants d'organisation sont masqués dans les erreurs renvoyées", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", failing(400, "Invalid key gsk_abcdefghijklmnop for org_01hxyzabcdef, Bearer abcdef1234567890"));
    const r = await gw.chat({ ...gw.hi, model: "groq/model-a" });
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes("abcdefghijklmnop") && !text.includes("01hxyzabcdef") && !text.includes("abcdef1234567890"), text);
    assert.match(r.json.error.message, /gsk_…/);
  }));

test("Gemini : erreur en tableau + délai conseillé dans le corps (retryDelay) lu comme Retry-After", () =>
  run({}, async (gw) => {
    up.on("gemini", "chat", {
      status: 429,
      json: [{ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34s" }] } }],
    });
    const r = await gw.chat({ ...gw.hi, model: "gemini/gem-1" });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "34");
    assert.match(r.json.error.details[0].message, /Quota exceeded/);
  }));

// ---------------------------------------------------------------- Déconnexion du client
test("si le client raccroche, l'appel au fournisseur est annulé et aucune autre tentative n'est lancée", () =>
  run({}, async (gw) => {
    up.on("groq", "chat", { delayMs: 3000, json: {} });
    const ctrl = new AbortController();
    const pending = gw.chat(gw.hi).catch(() => null);
    const req = fetch(`${gw.url}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer test-key-0123456789abcdef`, "Content-Type": "application/json" }, body: JSON.stringify(gw.hi), signal: ctrl.signal }).catch((e) => e.name);
    await sleep(250);
    ctrl.abort();
    assert.equal(await req, "AbortError");
    await sleep(300);
    const aborted = up.chatCalls("groq").filter((c) => c.aborted);
    assert.ok(aborted.length >= 1, "au moins un appel fournisseur annulé");
    await pending;
  }));

// ---------------------------------------------------------------- Robustesse générale
test("une exception inattendue donne un 500 JSON avec request_id (jamais un plantage)", () =>
  run({}, async (gw) => {
    gw.handler.providers.resolveChain = () => {
      throw new Error("bug imprévu");
    };
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 500);
    assert.equal(r.json.error.code, "internal_error");
    assert.equal(r.json.error.request_id, r.headers.get("x-request-id"));
    assert.ok(gw.log.lines.some((l) => l.startsWith("error ") && l.includes("bug imprévu")));
    assert.ok(!JSON.stringify(r.json).includes("bug imprévu"), "le détail interne n'est pas exposé");
  }));

test("fetch qui plante côté réseau : traité comme un échec du fournisseur (bascule), pas un crash", async () => {
  const { createHandler } = await import("../src/handler.js");
  const { memoryLogger } = await import("./_helpers.js");
  let n = 0;
  const handler = createHandler({
    env: { GATEWAY_KEYS: "k".repeat(20), GROQ_API_KEY: "g", GEMINI_API_KEY: "m", GROQ_MODEL: "only", GEMINI_MODEL: "gem" },
    log: memoryLogger(),
    fetch: async (url) => {
      n++;
      if (String(url).includes("groq")) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "only" }] }));
      return new Response(JSON.stringify({ id: "x", choices: [] }), { headers: { "content-type": "application/json" } });
    },
  });
  const http = await import("node:http");
  const server = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${"k".repeat(20)}` }, body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-provider"), "gemini");
    assert.ok(n >= 2);
  } finally {
    server.close();
  }
});
