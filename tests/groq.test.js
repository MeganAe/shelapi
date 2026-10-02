import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fakeClock, startUpstream, withGateway } from "./_helpers.js";

const up = await startUpstream();
after(() => up.close());
const run = (opts, fn) => withGateway(up, opts, fn);

const catalogue = (...ids) => ({ json: { object: "list", data: ids.map((id) => ({ id, active: true })) } });

test("la liste des modèles Groq est mise en cache (un seul appel /models pour plusieurs requêtes)", () =>
  run({}, async (gw) => {
    await gw.chat(gw.hi);
    await gw.chat(gw.hi);
    await gw.api("/v1/models");
    assert.equal(up.models("groq").length, 1);
  }));

test("requêtes simultanées à froid : un seul appel /models (pas de ruée vers le fournisseur)", () =>
  run({}, async (gw) => {
    up.on("groq", "models", { delayMs: 150, ...catalogue("model-a", "model-b") });
    const all = await Promise.all(Array.from({ length: 6 }, () => gw.chat(gw.hi)));
    assert.ok(all.every((r) => r.status === 200));
    assert.equal(up.models("groq").length, 1);
  }));

test("cache négatif : /models en panne → repli sur GROQ_MODEL, sans re-solliciter Groq à chaque requête", () => {
  const clock = fakeClock();
  return run({ now: clock.now }, async (gw) => {
    up.on("groq", "models", { status: 500, json: { error: { message: "down" } } });
    const r = await gw.chat(gw.hi);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-model"), "model-a", "repli sur le modèle configuré");
    await gw.chat(gw.hi);
    await gw.chat(gw.hi);
    assert.equal(up.models("groq").length, 1, "une seule tentative pendant la minute qui suit");
    clock.advance(61_000);
    await gw.chat(gw.hi);
    assert.equal(up.models("groq").length, 2, "retentée après le délai");
  });
});

test("seuls les modèles de chat actifs sont retenus (pas de whisper, TTS, guard, ni de modèle désactivé)", () =>
  run({}, async (gw) => {
    const r = await gw.api("/groq");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.models.map((m) => m.id), ["model-a", "model-b"]);
  }));

// ---------------------------------------------------------------- Ordre des modèles
// Constat sur un déploiement réel : Groq a inversé l'ordre de sa liste en une heure. Sans ordre propre à la passerelle,
// le modèle qui répond en premier changeait tout seul.
const BY_SIZE = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "allam-2-7b", "groq/compound"];
for (const [name, apiOrder] of [
  ["ordre A", ["allam-2-7b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b", "groq/compound"]],
  ["ordre inverse", ["groq/compound", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "allam-2-7b"]],
]) {
  test(`modèles non épinglés : du plus grand au plus petit, quel que soit l'ordre renvoyé par Groq (${name})`, () =>
    run({ env: { GROQ_MODEL: "modele-retire" } }, async (gw) => {
      up.on("groq", "models", catalogue(...apiOrder));
      assert.deepEqual((await gw.api("/groq")).json.models.map((m) => m.id), BY_SIZE);
      const r = await gw.chat(gw.hi);
      assert.equal(r.headers.get("x-model"), "openai/gpt-oss-120b", "auto commence par le plus grand");
    }));
}

test("tailles lues dans l'identifiant : décimales acceptées, « foo7b » (sans séparateur) et l'absence de taille passent après", () =>
  run({ env: { GROQ_MODEL: "modele-retire" } }, async (gw) => {
    up.on("groq", "models", catalogue("modele-sans-taille", "petit-8b", "foo7b", "grand-70b", "moyen-8.5b", "grand-70b"));
    assert.deepEqual((await gw.api("/groq")).json.models.map((m) => m.id), ["grand-70b", "moyen-8.5b", "petit-8b", "foo7b", "modele-sans-taille"], "doublons de l'API supprimés");
  }));

test("GROQ_MODEL passe en premier, dans l'ordre demandé ; les autres suivent du plus grand au plus petit", () =>
  run({ env: { GROQ_MODEL: "allam-2-7b, qwen/qwen3.8-27b, allam-2-7b" } }, async (gw) => {
    up.on("groq", "models", catalogue("openai/gpt-oss-20b", "qwen/qwen3.8-27b", "allam-2-7b", "openai/gpt-oss-120b"));
    assert.deepEqual((await gw.api("/groq")).json.models.map((m) => m.id), ["allam-2-7b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  }));

test("GROQ_MODEL cite un modèle retiré : avertissement dans les journaux (une seule fois), modèle ignoré", () =>
  run({ env: { GROQ_MODEL: "model-a, llama-3.3-70b-versatile" } }, async (gw) => {
    assert.deepEqual((await gw.api("/groq")).json.models.map((m) => m.id), ["model-a", "model-b"]);
    await gw.chat(gw.hi);
    const warnings = gw.log.lines.filter((l) => l.startsWith("warn") && l.includes("GROQ_MODEL"));
    assert.equal(warnings.length, 1, "un seul avertissement par chargement de la liste");
    assert.match(warnings[0], /llama-3\.3-70b-versatile/);
    assert.doesNotMatch(warnings[0], /model-a/, "seuls les modèles introuvables sont cités");
  }));

test("aucun avertissement quand tous les modèles de GROQ_MODEL existent", () =>
  run({}, async (gw) => {
    await gw.chat(gw.hi);
    assert.deepEqual(gw.log.lines.filter((l) => l.includes("GROQ_MODEL")), []);
  }));

test("GET /groq : les URL des endpoints suivent l'hôte et le protocole de la requête (proxy Vercel)", () =>
  run({}, async (gw) => {
    const local = await gw.api("/groq");
    assert.equal(local.json.models[0].endpoint, `${gw.url}/groq/model-a`);
    const proxied = await gw.api("/groq", { headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "api.exemple.com" } });
    assert.equal(proxied.json.models[0].endpoint, "https://api.exemple.com/groq/model-a");
    assert.equal(proxied.json.count, 2);
  }));

test("POST /groq/<modèle> : modèle imposé (le champ model du corps est ignoré), sans bascule", () =>
  run({}, async (gw) => {
    const r = await gw.api("/groq/model-b", { method: "POST", body: { ...gw.hi, model: "autre-chose" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-model"), "model-b");
    assert.equal(up.chatCalls("groq")[0].body.model, "model-b");

    up.on("groq", "chat", { status: 500, json: { error: { message: "x" } } });
    const failed = await gw.api("/groq/model-b", { method: "POST", body: gw.hi });
    assert.equal(failed.status, 502);
    assert.equal(up.chatCalls("gemini").length, 0);
  }));

test("POST /groq/<modèle inconnu> → 404 model_not_found", () =>
  run({}, async (gw) => {
    const r = await gw.api("/groq/nexiste-pas", { method: "POST", body: gw.hi });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "model_not_found");
    assert.equal(r.json.error.param, "model");
  }));

test("l'URL accepte aussi le suffixe /chat/completions et /v1/chat/completions", () =>
  run({}, async (gw) => {
    for (const suffix of ["/chat/completions", "/v1/chat/completions", "/"]) {
      const r = await gw.api(`/groq/model-b${suffix}`, { method: "POST", body: gw.hi });
      assert.equal(r.status, 200, suffix);
      assert.equal(r.headers.get("x-model"), "model-b");
    }
  }));

test("identifiants de modèles contenant un « / » (openai/gpt-oss-120b), brut ou encodé", () =>
  run({}, async (gw) => {
    up.on("groq", "models", catalogue("openai/gpt-oss-120b", "model-a"));
    for (const path of ["/groq/openai/gpt-oss-120b", "/groq/openai%2Fgpt-oss-120b", "/groq/openai/gpt-oss-120b/chat/completions"]) {
      const r = await gw.api(path, { method: "POST", body: gw.hi });
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get("x-model"), "openai/gpt-oss-120b");
    }
  }));

test("URL mal encodée (%E0%A4%A) : 400 propre, le serveur reste vivant (l'ancien code plantait)", () =>
  run({}, async (gw) => {
    const r = await gw.api("/groq/%E0%A4%A", { method: "POST", body: gw.hi });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, "invalid_request");
    assert.equal((await gw.api("/health", { key: null })).status, 200);
  }));

test("sans GROQ_API_KEY : 503 provider_not_configured", () =>
  run({ env: { GROQ_API_KEY: undefined } }, async (gw) => {
    const r = await gw.api("/groq");
    assert.equal(r.status, 503);
    assert.equal(r.json.error.code, "provider_not_configured");
  }));

test("GET sur /groq/<modèle> → 405 avec l'en-tête Allow", () =>
  run({}, async (gw) => {
    const r = await gw.api("/groq/model-a");
    assert.equal(r.status, 405);
    assert.match(r.headers.get("allow"), /POST/);
  }));
