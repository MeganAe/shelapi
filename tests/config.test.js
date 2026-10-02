import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, loadConfig, parseInteger, parseList } from "../src/config.js";
import { ERRORS, GatewayError, redact } from "../src/http.js";
import { classifyFailure, parseRetryAfter } from "../src/chat.js";
import { createLogger, validateChatBody } from "../src/handler.js";

test("parseList : espaces, doublons vides, valeur de repli", () => {
  assert.deepEqual(parseList(" a, b ,,c "), ["a", "b", "c"]);
  assert.deepEqual(parseList("", ["x"]), ["x"]);
  assert.deepEqual(parseList(undefined, ["x"]), ["x"]);
  assert.deepEqual(parseList(" , "), []);
});

test("parseInteger : valeurs invalides → repli ; trop grandes → plafonnées", () => {
  assert.equal(parseInteger(undefined, 7), 7);
  assert.equal(parseInteger("", 7), 7);
  assert.equal(parseInteger("abc", 7), 7);
  assert.equal(parseInteger("-5", 7, { min: 0 }), 7);
  assert.equal(parseInteger("100", 7, { min: 500 }), 7, "sous le minimum : repli, pas de valeur dangereuse");
  assert.equal(parseInteger("9999999", 7, { max: 1000 }), 1000);
  assert.equal(parseInteger("12.9", 7), 12);
});

test("loadConfig : valeurs par défaut", () => {
  const c = loadConfig({});
  assert.deepEqual(c.providers.map((p) => [p.name, p.enabled]), [["groq", false], ["gemini", false], ["cloudflare", false]]);
  assert.deepEqual(c.providers[0].models, DEFAULTS.groqModels);
  assert.deepEqual(c.providers[1].models, DEFAULTS.geminiModels);
  assert.equal(c.timeoutMs, 20_000);
  assert.equal(c.deadlineMs, 50_000);
  assert.equal(c.maxBodyBytes, 4 * 1024 * 1024);
  assert.deepEqual(c.corsOrigins, ["*"]);
  assert.ok(Object.isFrozen(c));
});

test("loadConfig : Cloudflare exige le jeton ET l'identifiant de compte ; l'URL de base encode le compte", () => {
  assert.equal(loadConfig({ CLOUDFLARE_API_TOKEN: "t" }).providers[2].enabled, false);
  assert.equal(loadConfig({ CLOUDFLARE_ACCOUNT_ID: "a" }).providers[2].enabled, false);
  const ok = loadConfig({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a/b" }).providers[2];
  assert.equal(ok.enabled, true);
  assert.equal(ok.baseUrl, "https://api.cloudflare.com/client/v4/accounts/a%2Fb/ai/v1");
});

test("loadConfig : listes de modèles, URL de base sans barre finale, délais bornés", () => {
  const c = loadConfig({ GEMINI_MODEL: "m1, m2", GROQ_BASE_URL: "https://proxy.test/openai/v1///", TIMEOUT_MS: "100", DEADLINE_MS: "999999999" });
  assert.deepEqual(c.providers[1].models, ["m1", "m2"]);
  assert.equal(c.providers[0].baseUrl, "https://proxy.test/openai/v1");
  assert.equal(c.timeoutMs, 20_000, "TIMEOUT_MS trop petit → défaut");
  assert.equal(c.deadlineMs, 300_000, "DEADLINE_MS trop grand → plafonné");
});

test("loadConfig : avertit pour les clés d'exemple, les clés courtes, l'absence de clé ou de fournisseur", () => {
  const warnings = (env) => loadConfig(env).warnings.join("\n");
  assert.match(warnings({ GATEWAY_KEYS: "cle-projet-1,cle-projet-2", GROQ_API_KEY: "g" }), /valeur d'exemple « cle-projet-1 »/);
  assert.match(warnings({ GATEWAY_KEYS: "court", GROQ_API_KEY: "g" }), /moins de 16 caractères/);
  assert.match(warnings({ GROQ_API_KEY: "g" }), /GATEWAY_KEYS est vide/);
  assert.match(warnings({ GATEWAY_KEYS: "k".repeat(24) }), /Aucun fournisseur/);
  assert.equal(warnings({ GATEWAY_KEYS: "k".repeat(24), GROQ_API_KEY: "g" }), "");
});

test("redact : masque les clés et identifiants d'organisation, laisse le reste intact", () => {
  assert.equal(redact("clé gsk_abcdefghij1234 invalide"), "clé gsk_… invalide");
  assert.equal(redact("AIzaSyA-1234567890_abc et sk-proj-abcdef123456"), "AIza… et sk-…");
  assert.equal(redact("Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"), "Bearer …");
  assert.equal(redact("organization org_01hxyzabcdef"), "organization org_…");
  assert.equal(redact("Limite atteinte pour le modèle gemini-3.8-flash"), "Limite atteinte pour le modèle gemini-3.8-flash");
  assert.equal(redact(undefined), "");
});

test("parseRetryAfter : secondes, date HTTP, retryDelay de Gemini, valeurs absurdes ignorées", () => {
  const now = () => Date.parse("2026-10-02T12:00:00Z");
  assert.equal(parseRetryAfter("30", "", now), 30);
  assert.equal(parseRetryAfter("Fri, 02 Oct 2026 12:01:00 GMT", "", now), 60);
  assert.equal(parseRetryAfter(null, '{"retryDelay":"34s"}', now), 34);
  assert.equal(parseRetryAfter(null, '{"retryDelay": "2.5s"}', now) >= 2, true);
  assert.equal(parseRetryAfter("abc", "", now), null);
  assert.equal(parseRetryAfter(null, "", now), null);
  assert.equal(parseRetryAfter("-5", "", now), null);
});

test("classifyFailure : statut + code + message → nature de l'échec", () => {
  assert.equal(classifyFailure(429, "", ""), "rate_limit");
  assert.equal(classifyFailure(401, "", ""), "auth");
  assert.equal(classifyFailure(403, "", ""), "auth");
  assert.equal(classifyFailure(404, "", ""), "model_unavailable");
  assert.equal(classifyFailure(410, "", ""), "model_unavailable");
  assert.equal(classifyFailure(400, "model_decommissioned", ""), "model_unavailable");
  assert.equal(classifyFailure(400, "", "The model `x` has been decommissioned"), "model_unavailable");
  assert.equal(classifyFailure(400, "", "invalid temperature"), "client");
  assert.equal(classifyFailure(422, "", ""), "client");
  assert.equal(classifyFailure(500, "", ""), "server");
  assert.equal(classifyFailure(503, "", ""), "server");
});

test("validateChatBody : accepte une requête valide, y compris model null et contenu multimodal", () => {
  validateChatBody({ messages: [{ role: "user", content: [{ type: "text", text: "salut" }] }], model: null, stream: false });
  assert.throws(() => validateChatBody({ messages: [{ role: 1 }] }), GatewayError);
});

test("GatewayError : code inconnu → internal_error (jamais d'objet d'erreur incohérent)", () => {
  const e = new GatewayError("code_qui_nexiste_pas");
  assert.equal(e.code, "internal_error");
  assert.equal(e.status, ERRORS.internal_error.status);
});

test("createLogger : respecte LOG_LEVEL", () => {
  const out = [];
  const sink = { log: (m) => out.push(`log:${m}`), warn: (m) => out.push(`warn:${m}`), error: (m) => out.push(`error:${m}`) };
  const l = createLogger("warn", sink);
  l.info("a");
  l.warn("b");
  l.error("c");
  assert.deepEqual(out, ["warn:b", "error:c"]);
  const silent = createLogger("silent", sink);
  silent.error("x");
  assert.equal(out.length, 2);
});
