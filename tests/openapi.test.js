import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { ERRORS } from "../src/http.js";
import { buildOpenApi } from "../src/openapi.js";
import { VERSION } from "../src/version.js";
import { startUpstream, withGateway } from "./_helpers.js";

const up = await startUpstream();
after(() => up.close());
const run = (opts, fn) => withGateway(up, opts, fn);

const spec = buildOpenApi({ serverUrl: "https://api.exemple.com" });
const operations = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => ({ path, method: method.toUpperCase(), op })));

test("la version du paquet, de la passerelle et de la spécification OpenAPI est la même", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, VERSION);
  assert.equal(spec.info.version, VERSION);
  assert.equal(spec.openapi, "3.1.0");
});

test("tous les $ref de la spécification pointent vers un composant existant", () => {
  const refs = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) (k === "$ref" ? refs.push(v) : walk(v));
    }
  })(spec);
  assert.ok(refs.length > 5);
  for (const ref of refs) {
    const target = ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], spec);
    assert.ok(target, `$ref cassé : ${ref}`);
  }
});

test("chaque opération a un operationId unique, un résumé, une description et au moins une réponse 2xx", () => {
  const ids = operations.map((o) => o.op.operationId);
  assert.equal(new Set(ids).size, ids.length);
  for (const { path, method, op } of operations) {
    assert.ok(op.operationId && op.summary && op.description, `${method} ${path}`);
    assert.ok(Object.keys(op.responses).some((c) => c.startsWith("2")), `${method} ${path} : pas de réponse 2xx`);
  }
});

test("les routes documentées sont exactement celles du routeur", () => {
  assert.deepEqual(operations.map((o) => `${o.method} ${o.path}`).sort(), [
    "GET /",
    "GET /groq",
    "GET /health",
    "GET /v1/models",
    "POST /groq/{model}",
    "POST /v1/chat/completions",
  ]);
});

test("le routeur reconnaît chaque opération documentée, et l'exigence de clé correspond à la spécification", () =>
  run({}, async (gw) => {
    for (const { path, method, op } of operations) {
      const url = path.replace("{model}", "model-a");
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      const r = await gw.api(url, { method, key: null });
      assert.notEqual(r.status, 404, `${method} ${path} non routée`);
      assert.notEqual(r.status, 405, `${method} ${path} : mauvaise méthode dans la spec`);
      if (isPublic) assert.equal(r.status, 200, `${method} ${path} devrait être publique`);
      else assert.equal(r.status, 401, `${method} ${path} devrait exiger une clé`);
    }
  }));

test("le schéma Error liste exactement les codes du catalogue d'erreurs, et leurs statuts HTTP sont documentés", () => {
  assert.deepEqual(spec.components.schemas.Error.properties.error.properties.code.enum, Object.keys(ERRORS));
  const documented = new Set(operations.flatMap((o) => Object.keys(o.op.responses)).map(Number));
  const omittedOnPurpose = new Set([405, 500]); // communes à toute API
  for (const [code, def] of Object.entries(ERRORS)) {
    if (!omittedOnPurpose.has(def.status)) assert.ok(documented.has(def.status), `statut ${def.status} (${code}) non documenté`);
  }
});

test("GET /openapi.json : public, valide, et « servers » suit l'URL réelle (hôte / proxy)", () =>
  run({}, async (gw) => {
    const direct = await gw.api("/openapi.json", { key: null });
    assert.equal(direct.status, 200);
    assert.match(direct.headers.get("content-type"), /^application\/json/);
    assert.equal(direct.json.servers[0].url, gw.url);
    assert.deepEqual(direct.json.paths, spec.paths);

    const proxied = await gw.api("/openapi.json", { key: null, headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "api.exemple.com" } });
    assert.equal(proxied.json.servers[0].url, "https://api.exemple.com");

    // Un en-tête Host malveillant ne doit pas pouvoir injecter n'importe quoi dans la spécification.
    const evil = await gw.api("/openapi.json", { key: null, headers: { "X-Forwarded-Host": 'x"><script>alert(1)</script>' } });
    assert.equal(evil.json.servers[0].url, "http://localhost");
  }));
