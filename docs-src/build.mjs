// Génère public/docs/index.html : une page unique et autonome (CSS, polices, icônes et scripts intégrés).
//
//   cd docs-src && npm install && npm run build      (ou, depuis la racine : npm run docs:install && npm run docs:build)
//
// Le fichier produit est versionné dans Git : le déploiement ne nécessite AUCUNE étape de build.
// À relancer quand src/openapi.js, src/http.js (codes d'erreur) ou docs-src/ changent.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenApi } from "../src/openapi.js";
import { VERSION } from "../src/version.js";
import { REPOSITORY_URL, createContent, navigation } from "./content.mjs";
import { BASE_URL, button, inlineSnippet, tag } from "./lib/carbon.mjs";
import { esc, prose } from "./lib/html.mjs";
import { icon } from "./lib/icons.mjs";
import { createReference } from "./lib/reference.mjs";
import { sourceHash } from "./lib/source-hash.mjs";
import { compileStyles, fontFaces } from "./lib/styles.mjs";

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const OUTPUT = here("../public/docs/index.html");

const spec = buildOpenApi({ serverUrl: BASE_URL });
const reference = createReference(spec);
const { sections } = createContent(spec, reference);

const css = fontFaces() + compileStyles();
const themeInit = readFileSync(here("client/theme-init.js"), "utf8").trim();
const app = readFileSync(here("client/app.js"), "utf8").trim();
for (const [name, text] of [["CSS", css], ["theme-init.js", themeInit], ["app.js", app]]) {
  if (/<\/(script|style)/i.test(text)) throw new Error(`${name} contient une balise de fermeture : intégration impossible`);
}

// Politique de sécurité : seuls NOS scripts et NOTRE style (identifiés par leur empreinte) s'exécutent ;
// aucune ressource externe ; les requêtes ne peuvent aller que vers la passerelle elle-même.
const hash = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const csp = [
  "default-src 'none'",
  `script-src ${hash(themeInit)} ${hash(app)}`,
  `style-src ${hash(css)}`,
  "img-src data:",
  "font-src data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const favicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f62fe"/><path fill="#fff" d="M20.6 11.3c-.8-1-2-1.5-3.7-1.5-2 0-3.2.9-3.2 2.2 0 1.3 1 1.8 3.4 2.4 3.3.8 5.4 1.9 5.4 4.8 0 3.1-2.6 4.8-5.9 4.8-2.7 0-4.8-.9-6.2-2.7l2-1.9c1 1.2 2.4 1.9 4.2 1.9 1.7 0 3-.7 3-2.1 0-1.2-.8-1.8-3.4-2.4-3.1-.8-5.3-1.8-5.3-4.7 0-2.9 2.4-4.6 5.6-4.6 2.3 0 4 .8 5.2 2.3z"/></svg>')}`;

const description = "Documentation de Shel API : une passerelle IA compatible OpenAI avec bascule automatique entre Groq, Google Gemini et Cloudflare Workers AI.";

const header = `<header class="cds--header cds--g100 docs-header" aria-label="Shel API">
<button type="button" class="docs-menu-toggle" data-nav-toggle aria-controls="docs-sidenav" aria-expanded="false" aria-label="Ouvrir le menu">${icon("menu", 20, "docs-icon-open")}${icon("close", 20, "docs-icon-close")}</button>
<a class="cds--header__name" href="#top"><span class="cds--header__name--prefix">Shel</span>&nbsp;API</a>
<span class="docs-header__version">${tag(`v${VERSION}`, "cool-gray", { size: "sm" })}</span>
<div class="docs-header__links">
<a class="docs-header__link" href="/openapi.json" aria-label="Spécification OpenAPI" title="Spécification OpenAPI">${icon("launch", 16)}<span class="docs-header__text" aria-hidden="true">OpenAPI</span></a>
<a class="docs-header__link docs-header__link--icon" href="${esc(REPOSITORY_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Code source sur GitHub" title="Code source sur GitHub">${icon("logo--github", 20)}</a>
<button type="button" class="docs-header__link docs-header__link--icon docs-theme-toggle" data-theme-toggle aria-pressed="false" aria-label="Passer au thème sombre" title="Thème sombre">${icon("moon", 20, "docs-icon-moon")}${icon("light", 20, "docs-icon-sun")}</button>
</div>
</header>`;

const hero = `<div class="docs-hero"><div class="docs-container">
<p class="docs-eyebrow">Documentation de l’API · Version ${esc(VERSION)}</p>
<h1>Shel API</h1>
<p class="docs-lead">Une passerelle IA compatible OpenAI : un seul point d’accès pour Groq, Gemini et Cloudflare Workers AI, avec bascule automatique quand un modèle atteint sa limite ou tombe en panne.</p>
<div class="docs-actions">${button("Démarrage rapide", { href: "#demarrage", iconName: "arrow--right" })}${button("Essayer l'API", { href: "#essayer", kind: "tertiary" })}${button("Spécification OpenAPI", { href: "/openapi.json", kind: "ghost", iconName: "launch" })}</div>
<dl class="docs-facts">
<div><dt>URL de base</dt><dd>${inlineSnippet(BASE_URL, { base: true })}</dd></div>
<div><dt>Authentification</dt><dd><code>Authorization: Bearer &lt;clé&gt;</code></dd></div>
<div><dt>Format</dt><dd>JSON · Server-Sent Events</dd></div>
<div><dt>Version</dt><dd>${esc(VERSION)} · OpenAPI 3.1</dd></div>
</dl>
</div></div>`;

const footer = `<footer class="docs-footer"><div class="docs-container">
<span>Shel API v${esc(VERSION)} · <a class="cds--link" href="/openapi.json">Spécification OpenAPI</a> · <a class="cds--link" href="${esc(REPOSITORY_URL)}" target="_blank" rel="noopener noreferrer">Code source</a></span>
<span>Interface : Carbon Design System (Apache-2.0) · Police : IBM Plex (SIL OFL 1.1)</span>
</div></footer>`;

const page = `<!doctype html>
<html lang="fr" data-carbon-theme="white">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shel API — Documentation</title>
<meta name="description" content="${esc(description)}">
<meta name="docs-source" content="${sourceHash()}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#161616">
<link rel="icon" href="${favicon}">
<!-- Page générée par docs-src/build.mjs : ne pas modifier à la main (voir le README). Carbon Design System © IBM (Apache-2.0) ; IBM Plex © IBM Corp. (SIL OFL 1.1, https://github.com/IBM/plex/blob/master/LICENSE.txt). -->
<script>${themeInit}</script>
<style>${css}</style>
</head>
<body id="top">
<a class="cds--skip-to-content" href="#main-content">Aller au contenu principal</a>
${header}
<div class="docs-overlay" data-overlay hidden></div>
<nav class="cds--side-nav cds--side-nav--expanded docs-sidenav" id="docs-sidenav" aria-label="Plan de la documentation"><ul class="cds--side-nav__items">${navigation(reference)}</ul></nav>
<main id="main-content" class="docs-main" tabindex="-1">
${hero}
<div class="docs-container">
${sections}
</div>
${footer}
</main>
<script>${app}</script>
</body>
</html>
`;

mkdirSync(here("../public/docs"), { recursive: true });
writeFileSync(OUTPUT, page, "utf8");

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;
console.log(`✔ public/docs/index.html — ${kb(Buffer.byteLength(page))} (CSS ${kb(css.length)}, JS ${kb(app.length)})`);
console.log(`  ${reference.operationIds().length} opérations, version ${VERSION}`);
