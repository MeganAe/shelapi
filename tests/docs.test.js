// Garde-fous de la page de documentation (public/docs/index.html, générée par `npm run docs:build`).
// Aucune dépendance : le HTML est analysé avec des expressions régulières.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sourceHash } from "../docs-src/lib/source-hash.mjs";
import { ERRORS } from "../src/http.js";
import { buildOpenApi } from "../src/openapi.js";
import { VERSION } from "../src/version.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const page = read("public/docs/index.html");
const markup = page.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*?<\/script>/g, ""); // sans CSS ni JS
const spec = buildOpenApi({ serverUrl: "https://exemple.invalid" });

test("la documentation est à jour avec l'API (sinon : npm run docs:build)", () => {
  const embedded = /<meta name="docs-source" content="([0-9a-f]+)">/.exec(page)?.[1];
  assert.equal(embedded, sourceHash(), "La spécification, les codes d'erreur ou les valeurs par défaut ont changé : relancez `npm run docs:build` puis commitez public/docs/index.html.");
});

test("chaque opération, chaque chemin et chaque code d'erreur de l'API figurent dans la page", () => {
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      assert.ok(markup.includes(`id="op-${op.operationId}"`), `opération absente : ${op.operationId}`);
      assert.ok(markup.includes(`>${path}</span>`), `chemin absent : ${method.toUpperCase()} ${path}`);
    }
  }
  for (const code of Object.keys(ERRORS)) assert.ok(markup.includes(`<code>${code}</code>`), `code d'erreur absent : ${code}`);
  for (const name of Object.keys(spec.components.schemas)) assert.ok(markup.includes(`id="schema-${name}"`), `schéma absent : ${name}`);
});

test("la version affichée est celle du paquet", () => {
  assert.ok(markup.includes(`v${VERSION}`));
  assert.equal(JSON.parse(read("package.json")).version, VERSION);
});

test("page autonome : aucune ressource externe (CSS, JS, images, polices, cadres)", () => {
  assert.doesNotMatch(markup, /<link[^>]+rel="(stylesheet|preload|prefetch|modulepreload)"/i);
  assert.doesNotMatch(markup, /<script[^>]+src=/i);
  assert.doesNotMatch(markup, /<(img|iframe|embed|object|video|audio|source)\b/i);
  assert.doesNotMatch(page, /url\(\s*['"]?https?:/i);
  assert.doesNotMatch(page, /@import/i);
  // seuls liens sortants autorisés : le dépôt GitHub
  const external = [...markup.matchAll(/\s(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(external)], ["https://github.com/MeganAe/shelapi"]);
  assert.doesNotMatch(markup, /\sstyle="/, "un attribut style= serait bloqué par la politique de sécurité");
});

test("la politique de sécurité (CSP) correspond exactement aux scripts et au style intégrés", () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1].replaceAll("&#39;", "'");
  assert.ok(csp, "balise CSP absente");
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /connect-src 'self'/);

  const hash = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const styles = [...page.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  assert.equal(styles.length, 1);
  for (const text of scripts) assert.ok(/script-src[^;]*/.exec(csp)[0].includes(hash(text)), "empreinte d'un script absente de la CSP : la page ne fonctionnerait plus");
  assert.ok(/style-src[^;]*/.exec(csp)[0].includes(hash(styles[0])), "empreinte du style absente de la CSP : la page s'afficherait sans mise en forme");
});

test("HTML cohérent : identifiants uniques, ancres et références ARIA résolues, langue et titre", () => {
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicates, []);
  const known = new Set(ids);
  for (const [, anchor] of markup.matchAll(/\shref="#([^"]+)"/g)) assert.ok(known.has(anchor), `ancre cassée : #${anchor}`);
  for (const [, attribute, value] of markup.matchAll(/\s(aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const target of value.split(/\s+/)) assert.ok(known.has(target), `${attribute} → #${target} introuvable`);
  }
  assert.match(page, /<html lang="fr"/);
  assert.match(page, /<title>[^<]+<\/title>/);
  assert.match(page, /<meta name="viewport"/);
  assert.match(markup, /<main id="main-content"/);
  assert.match(markup, /class="cds--skip-to-content" href="#main-content"/);
});

test("les variables d'environnement documentées sont exactement celles de .env.example", () => {
  const example = new Set([...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
  const table = /aria-label="Variables d&#39;environnement"[\s\S]*?<\/table>/.exec(markup)?.[0];
  assert.ok(table, "tableau des variables introuvable");
  const documented = new Set([...table.matchAll(/<code>([A-Z][A-Z0-9_]+)<\/code>/g)].map((m) => m[1]));
  // CLOUDFLARE_ACCOUNT_ID est décrit dans la ligne de CLOUDFLARE_API_TOKEN mais listé séparément : tout est comparé.
  assert.deepEqual([...documented].sort(), [...example].sort());
});

test("vercel.json : le dossier public/ est publié et la fonction reçoit le reste du trafic", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.equal(config.outputDirectory, "public");
  assert.ok(config.rewrites.some((r) => r.destination === "/api/index"));
  const docsHeaders = config.headers.find((h) => h.source.startsWith("/docs"));
  assert.ok(docsHeaders, "en-têtes de /docs/ absents");
  const names = docsHeaders.headers.map((h) => h.key.toLowerCase());
  assert.ok(names.includes("x-frame-options") && names.includes("cache-control"));
});
