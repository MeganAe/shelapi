// Contenu de la page de documentation (en français).
// Les valeurs techniques (durées, valeurs par défaut, codes d'erreur, exemples) sont LUES dans le code de l'API :
// la documentation ne peut donc pas contredire le comportement réel.
import { COOLDOWN } from "../src/chat.js";
import { DEFAULTS, loadConfig } from "../src/config.js";
import { ERRORS } from "../src/http.js";
import { VERSION } from "../src/version.js";
import { BASE_URL, accordion, button, copyButton, notification, select, snippet, statusTag, table, tabs, tag, textArea, textInput, toggle } from "./lib/carbon.mjs";
import { esc, join, prose } from "./lib/html.mjs";
import { icon } from "./lib/icons.mjs";
import { inline, markdown } from "./lib/markdown.mjs";
import { samples } from "./lib/samples.mjs";

export const REPOSITORY_URL = "https://github.com/MeganAe/shelapi";
const md = markdown;
const code = (text) => `<code>${esc(text)}</code>`;

const section = (id, title, body) =>
  `<section class="docs-section" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${prose(title)}<a class="docs-anchor" href="#${id}" aria-label="Lien vers la section « ${esc(title)} »">${icon("link", 16)}</a></h2>${body}</section>`;

const h3 = (id, title) => `<h3 id="${id}">${prose(title)}<a class="docs-anchor" href="#${id}" aria-label="Lien vers « ${esc(title)} »">${icon("link", 16)}</a></h3>`;

const defaults = loadConfig({});
const seconds = (ms) => (ms >= 3_600_000 ? `${ms / 3_600_000} h` : ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000} s`);
const megabytes = (bytes) => `${bytes / 1024 / 1024} Mo`;

// ---------------------------------------------------------------------------------------------
//  Exemples tirés de la spécification
// ---------------------------------------------------------------------------------------------
export function createContent(spec, reference) {
  const chat = spec.paths["/v1/chat/completions"].post;
  const chatExamples = chat.requestBody.content["application/json"].examples;
  const chatResponse = chat.responses[200].content;
  const rateLimitedExample = spec.components.responses.RateLimited.content["application/json"].examples.limite.value;
  const sseExample = chatResponse["text/event-stream"].examples.flux.value;
  const completionExample = chatResponse["application/json"].examples.reponse.value;

  const chatSamples = (body, { sdk = true } = {}) =>
    samples({ method: "POST", path: "/v1/chat/completions", body, sdk }).map((s) => ({ key: s.key, label: s.label, html: snippet(s.code, s.lang, { base: true, label: `Exemple ${s.label}` }) }));

  // ------------------------------------------------------------------------------------------
  //  Introduction
  // ------------------------------------------------------------------------------------------
  const features = [
    ["code", "Compatible OpenAI", "Gardez vos SDK et vos outils : changez seulement l'URL de base et la clé API."],
    ["renew", "Bascule automatique", "Limite atteinte, panne, délai dépassé : le modèle suivant prend le relais, sans intervention."],
    ["flash", "Streaming", "Recevez la réponse au fil de l'eau avec `stream: true` (Server-Sent Events)."],
    ["locked", "Une clé par projet", "Vos projets ont chacun leur clé ; les clés des fournisseurs restent sur le serveur."],
  ];

  const introduction = section(
    "introduction",
    "Introduction",
    join(
      `<div class="docs-prose">`,
      md(
        "Shel API est une **passerelle IA** : une seule API, au format d'OpenAI, qui répartit vos requêtes entre plusieurs fournisseurs — **Groq**, **Google Gemini** et **Cloudflare Workers AI** — et bascule automatiquement vers un autre modèle quand l'un d'eux atteint sa limite, tombe en panne ou ne répond pas à temps.",
      ),
      md("Vous écrivez votre code une seule fois ; la passerelle choisit le modèle qui répond, et vous indique lequel dans les en-têtes de la réponse."),
      `</div>`,
      `<div class="docs-cards">${features.map(([ic, title, text]) => `<div class="docs-card cds--tile">${icon(ic, 32)}<h3>${esc(title)}</h3><p>${inline(text)}</p></div>`).join("")}</div>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Démarrage rapide
  // ------------------------------------------------------------------------------------------
  const quickstart = section(
    "demarrage",
    "Démarrage rapide",
    join(
      `<div class="docs-prose">${md("Trois étapes suffisent pour obtenir votre première réponse.")}</div>`,
      `<ol class="docs-steps">`,
      `<li class="docs-step"><h3>Obtenez une clé</h3><div class="docs-prose">${md("Les clés d'accès sont définies par l'administrateur de la passerelle (variable `GATEWAY_KEYS`, une clé par projet). Conservez la vôtre dans une variable d'environnement, par exemple `GATEWAY_KEY`, et jamais dans le code source.")}${md("Vous administrez la passerelle ? Voir [Configuration et déploiement](#configuration).")}</div></li>`,
      `<li class="docs-step"><h3>Envoyez une requête</h3><div class="docs-prose">${md("Remplacez `$GATEWAY_KEY` par votre clé. L'adresse ci-dessous est celle de cette passerelle.")}</div>${tabs(chatSamples(Object.values(chatExamples)[0].value), { label: "Langage de l'exemple", group: "lang" })}</li>`,
      `<li class="docs-step"><h3>Lisez la réponse</h3><div class="docs-prose">${md("La réponse suit le format OpenAI. Les en-têtes `X-Provider` et `X-Model` indiquent le fournisseur et le modèle qui ont réellement répondu.")}</div>${snippet(JSON.stringify(completionExample, null, 2), "json", { label: "Exemple de réponse" })}</li>`,
      `</ol>`,
      notification("info", "Vous utilisez déjà un SDK OpenAI ?", md("Changez uniquement `baseURL` (l'adresse de la passerelle suivie de `/v1`) et la clé API : le reste de votre code ne change pas. Les exemples « SDK OpenAI » ci-dessus fonctionnent avec les SDK officiels JavaScript et Python.")),
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Authentification
  // ------------------------------------------------------------------------------------------
  const authentication = section(
    "authentification",
    "Authentification",
    join(
      `<div class="docs-prose">`,
      md("Toutes les routes, sauf `GET /`, `GET /health`, `GET /openapi.json` et cette documentation, exigent une clé projet. Envoyez-la dans l'en-tête `Authorization` :"),
      `</div>`,
      snippet("Authorization: Bearer VOTRE_CLE", "text", { label: "En-tête d'authentification" }),
      `<div class="docs-prose">${md("L'en-tête `X-Api-Key: <clé>` est aussi accepté, pour les outils qui ne savent pas envoyer `Authorization`.")}</div>`,
      table({
        head: ["Situation", "Statut", "Code d'erreur"],
        rows: [
          ["Aucune clé dans la requête", statusTag(401), code("missing_api_key")],
          ["Clé inconnue ou mal recopiée", statusTag(401), code("invalid_api_key")],
          ["La passerelle n'a aucune clé configurée", statusTag(503), code("server_misconfigured")],
        ],
        label: "Erreurs d'authentification",
        className: "docs-table--wrap",
      }),
      notification(
        "warning",
        "Gardez votre clé côté serveur",
        md("Ne placez jamais la clé dans une application web publique (JavaScript exécuté dans le navigateur) ni dans une application mobile : n'importe qui pourrait la lire. Appelez la passerelle depuis votre serveur."),
      ),
      `<div class="docs-prose">${md("**Navigateurs (CORS).** La passerelle répond aux requêtes de pré-vérification et, par défaut, autorise toutes les origines ; l'administrateur peut restreindre la liste avec `CORS_ORIGINS`. Les en-têtes `X-Request-Id`, `X-Provider`, `X-Model` et `Retry-After` sont lisibles depuis JavaScript.")}</div>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Modèles et routage
  // ------------------------------------------------------------------------------------------
  const cooldownRows = [
    ["Limite atteinte (HTTP 429)", "Modèle suivant", `Durée du \`Retry-After\` du fournisseur (${seconds(COOLDOWN.defaultRateLimitS * 1000)} par défaut, ${seconds(COOLDOWN.maxRateLimitS * 1000)} au maximum)`],
    ["Panne du fournisseur (5xx), erreur réseau, délai dépassé", "Modèle suivant", seconds(COOLDOWN.serverMs)],
    ["Modèle retiré ou inconnu (404, 410, « decommissioned »)", "Modèle suivant", seconds(COOLDOWN.unavailableMs)],
    ["Clé du fournisseur refusée (401, 403)", "Modèle suivant", seconds(COOLDOWN.authMs)],
    ["Requête refusée (400, 422…)", "Modèle suivant : un autre fournisseur peut l'accepter", "Aucune"],
  ].map(([situation, action, pause]) => [inline(situation), inline(action), inline(pause)]);

  const wideDiagram = `<svg class="d-wide" viewBox="0 0 760 296" role="img" aria-labelledby="dw-t dw-d" xmlns="http://www.w3.org/2000/svg">
<title id="dw-t">Parcours d'une requête</title>
<desc id="dw-d">Votre application envoie la requête à Shel API, qui l'adresse d'abord à Groq. Si Groq échoue ou est en pause, la requête passe à Gemini, puis à Cloudflare Workers AI.</desc>
<defs><marker id="dw-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10z" class="d-arrow"/></marker><marker id="dw-w" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10z" class="d-arrow d-arrow--warn"/></marker></defs>
<rect class="d-box" x="8" y="108" width="160" height="80"/><text class="d-text d-text--bold" x="88" y="143" text-anchor="middle">Votre application</text><text class="d-text d-text--small" x="88" y="165" text-anchor="middle">curl · SDK OpenAI</text>
<path class="d-line" d="M168 148H214" marker-end="url(#dw-a)"/>
<rect class="d-box d-box--accent" x="216" y="46" width="206" height="204"/><text class="d-text d-text--bold d-text--on-accent" x="319" y="80" text-anchor="middle">Shel API</text>
<text class="d-text d-text--on-accent" x="319" y="120" text-anchor="middle">Vérifie la clé</text><text class="d-text d-text--on-accent" x="319" y="148" text-anchor="middle">Valide la requête</text><text class="d-text d-text--on-accent" x="319" y="176" text-anchor="middle">Choisit les modèles</text><text class="d-text d-text--on-accent" x="319" y="204" text-anchor="middle">Bascule si besoin</text>
<path class="d-line" d="M422 148H466V54H508" marker-end="url(#dw-a)"/>
<rect class="d-box" x="510" y="20" width="242" height="68"/><text class="d-text d-text--bold" x="631" y="50" text-anchor="middle">1 · Groq</text><text class="d-text d-text--small" x="631" y="70" text-anchor="middle">Essayé en premier</text>
<path class="d-line d-line--dashed" d="M631 88V126" marker-end="url(#dw-w)"/><text class="d-text d-text--small" x="643" y="112">429 · 5xx · délai</text>
<rect class="d-box" x="510" y="128" width="242" height="68"/><text class="d-text d-text--bold" x="631" y="158" text-anchor="middle">2 · Gemini</text><text class="d-text d-text--small" x="631" y="178" text-anchor="middle">Si Groq échoue ou est en pause</text>
<path class="d-line d-line--dashed" d="M631 196V234" marker-end="url(#dw-w)"/><text class="d-text d-text--small" x="643" y="220">429 · 5xx · délai</text>
<rect class="d-box" x="510" y="236" width="242" height="56"/><text class="d-text d-text--bold" x="631" y="262" text-anchor="middle">3 · Cloudflare Workers AI</text><text class="d-text d-text--small" x="631" y="281" text-anchor="middle">Dernier recours</text>
</svg>`;

  const narrowDiagram = `<svg class="d-narrow" viewBox="0 0 320 568" role="img" aria-labelledby="dn-t dn-d" xmlns="http://www.w3.org/2000/svg">
<title id="dn-t">Parcours d'une requête</title>
<desc id="dn-d">Votre application envoie la requête à Shel API, qui l'adresse d'abord à Groq. Si Groq échoue ou est en pause, la requête passe à Gemini, puis à Cloudflare Workers AI.</desc>
<defs><marker id="dn-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10z" class="d-arrow"/></marker><marker id="dn-w" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 10 5 0 10z" class="d-arrow d-arrow--warn"/></marker></defs>
<rect class="d-box" x="40" y="4" width="240" height="64"/><text class="d-text d-text--bold" x="160" y="33" text-anchor="middle">Votre application</text><text class="d-text d-text--small" x="160" y="53" text-anchor="middle">curl · SDK OpenAI</text>
<path class="d-line" d="M160 68V100" marker-end="url(#dn-a)"/>
<rect class="d-box d-box--accent" x="40" y="102" width="240" height="152"/><text class="d-text d-text--bold d-text--on-accent" x="160" y="132" text-anchor="middle">Shel API</text>
<text class="d-text d-text--on-accent" x="160" y="168" text-anchor="middle">Vérifie la clé</text><text class="d-text d-text--on-accent" x="160" y="192" text-anchor="middle">Valide la requête</text><text class="d-text d-text--on-accent" x="160" y="216" text-anchor="middle">Choisit les modèles</text><text class="d-text d-text--on-accent" x="160" y="240" text-anchor="middle">Bascule si besoin</text>
<path class="d-line" d="M160 254V286" marker-end="url(#dn-a)"/>
<rect class="d-box" x="40" y="288" width="240" height="64"/><text class="d-text d-text--bold" x="160" y="317" text-anchor="middle">1 · Groq</text><text class="d-text d-text--small" x="160" y="337" text-anchor="middle">Essayé en premier</text>
<path class="d-line d-line--dashed" d="M160 352V392" marker-end="url(#dn-w)"/><text class="d-text d-text--small" x="172" y="376">429 · 5xx · délai</text>
<rect class="d-box" x="40" y="394" width="240" height="64"/><text class="d-text d-text--bold" x="160" y="423" text-anchor="middle">2 · Gemini</text><text class="d-text d-text--small" x="160" y="443" text-anchor="middle">Si Groq échoue ou est en pause</text>
<path class="d-line d-line--dashed" d="M160 458V498" marker-end="url(#dn-w)"/><text class="d-text d-text--small" x="172" y="482">429 · 5xx · délai</text>
<rect class="d-box" x="40" y="500" width="240" height="64"/><text class="d-text d-text--bold" x="160" y="529" text-anchor="middle">3 · Cloudflare Workers AI</text><text class="d-text d-text--small" x="160" y="549" text-anchor="middle">Dernier recours</text>
</svg>`;

  const routing = section(
    "routage",
    "Modèles et routage",
    join(
      `<div class="docs-prose">${md("Le champ `model` de la requête pilote le **routage**. Les identifiants ont la forme `fournisseur/modèle` et sont listés par `GET /v1/models`.")}</div>`,
      table({
        head: ["Valeur du champ model", "Comportement", "Bascule"],
        rows: [
          [`${code("auto")}, absent, ou valeur inconnue (ex. ${code("gpt-4o")})`, inline("Tous les modèles de tous les fournisseurs configurés, dans l'ordre : Groq, puis Gemini, puis Cloudflare."), "Oui"],
          [`${code("groq")}, ${code("gemini")} ou ${code("cloudflare")}`, inline("Uniquement les modèles de ce fournisseur."), "Oui, entre ses modèles"],
          [code("groq/openai/gpt-oss-120b"), inline("Exactement ce modèle (format `fournisseur/modèle`)."), "Non"],
        ],
        label: "Valeurs du champ model",
        className: "docs-table--wrap",
      }),
      `<div class="docs-prose">${md("Une valeur inconnue — par exemple `gpt-4o`, souvent imposée par un SDK — est traitée comme `auto` : votre code existant fonctionne sans modification. Il en va de même pour un fournisseur dont la clé n'est pas configurée sur la passerelle.")}</div>`,
      h3("bascule", "Comment fonctionne la bascule"),
      `<figure class="docs-diagram">${wideDiagram}${narrowDiagram}<figcaption>Le premier modèle qui répond l'emporte : sa réponse vous est renvoyée telle quelle, avec les en-têtes <code>X-Provider</code> et <code>X-Model</code>.</figcaption></figure>`,
      `<div class="docs-prose">${md("Quand un modèle échoue, la passerelle le met **en pause** pour un temps adapté à la cause, puis passe au suivant. Tant qu'il reste d'autres modèles à essayer, un modèle en pause est ignoré : les requêtes suivantes ne perdent pas de temps avec lui.")}</div>`,
      table({ head: ["Situation", "Réaction", "Pause du modèle"], rows: cooldownRows, label: "Règles de bascule et de pause", className: "docs-table--wrap" }),
      `<div class="docs-prose">${md("Si tous les modèles sont limités ou en pause, la réponse est `429 rate_limited`, avec un en-tête `Retry-After` indiquant le délai le plus court. Dans les autres cas, la réponse est `502 upstream_error` (ou `400 upstream_rejected` quand tous les fournisseurs jugent la requête invalide, ou `504 deadline_exceeded` quand le délai total est dépassé) : le champ `details` donne la cause pour chaque modèle essayé.")}</div>`,
      notification(
        "info",
        "Les pauses sont propres à chaque instance",
        md("Sur Vercel, chaque instance de la fonction garde ses pauses en mémoire. Elles ne sont donc pas partagées : au pire, une instance retente un modèle déjà en pause ailleurs, ce qui coûte une tentative, jamais une erreur."),
      ),
      h3("modele-impose", "Imposer un modèle"),
      `<div class="docs-prose">${md("Avec `fournisseur/modèle`, **aucune bascule** n'est faite et la pause éventuelle du modèle est ignorée : vous obtenez le modèle demandé ou une erreur explicite (`404 model_not_found` s'il n'existe pas ou plus, `429`, `502`, `504`…). C'est le mode à privilégier pour comparer des modèles ou reproduire un résultat.")}${md("Pour les outils qui n'acceptent qu'une URL par modèle, `GET /groq` liste un point d'accès dédié par modèle Groq (`POST /groq/<modèle>`).")}</div>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Streaming
  // ------------------------------------------------------------------------------------------
  const streamBody = chatExamples.streaming.value;
  const midStreamError = `data: ${JSON.stringify({ error: { message: "Le flux du fournisseur a été interrompu.", type: "api_error", code: "upstream_error", request_id: "req_3f9a1c7e2b5d4a60" } })}`;

  const streaming = section(
    "streaming",
    "Streaming (SSE)",
    join(
      `<div class="docs-prose">${md("Ajoutez `\"stream\": true` pour recevoir la réponse au fur et à mesure, au format **Server-Sent Events** (le même que celui d'OpenAI). Le texte s'affiche dès qu'il est produit, sans attendre la fin de la génération.")}</div>`,
      tabs(chatSamples(streamBody), { label: "Langage de l'exemple de streaming", group: "lang" }),
      h3("format-sse", "Format des événements"),
      `<div class="docs-prose">${md("Chaque événement est une ligne `data: {…}` suivie d'une ligne vide. Le texte est dans `choices[0].delta.content`. Le flux se termine par `data: [DONE]`.")}</div>`,
      snippet(sseExample, "sse", { label: "Exemple de flux SSE" }),
      h3("streaming-erreurs", "Erreurs pendant un flux"),
      `<div class="docs-prose">${md("La bascule n'est possible qu'**avant le premier octet** : si un modèle échoue avant de commencer à répondre, le suivant est essayé de façon transparente. Une fois la réponse commencée, la passerelle ne peut plus changer de modèle. Si le flux est interrompu (panne du fournisseur, délai total dépassé), elle envoie un dernier événement d'erreur, puis ferme le flux :")}</div>`,
      snippet(midStreamError, "sse", { label: "Événement d'erreur dans un flux" }),
      `<div class="docs-prose">${md("Vérifiez donc la présence d'un champ `error` dans chaque événement, comme dans les exemples ci-dessus. Fermer la connexion (annuler la requête) interrompt aussi l'appel au fournisseur : vous ne payez pas des jetons que vous ne lisez pas.")}${md("Avec `curl`, utilisez l'option `-N` pour désactiver la mise en tampon.")}</div>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Erreurs
  // ------------------------------------------------------------------------------------------
  const ADVICE = {
    missing_api_key: "Ajoutez l'en-tête `Authorization: Bearer <clé>` à la requête.",
    invalid_api_key: "Vérifiez la clé (espace ou retour à la ligne en trop, mauvais projet) ou demandez-en une à l'administrateur.",
    invalid_json: "Envoyez un corps JSON valide (un objet) avec `Content-Type: application/json`.",
    invalid_request: "Corrigez le champ indiqué dans `param` : le message explique ce qui est attendu.",
    payload_too_large: `Réduisez la taille de la requête (${megabytes(defaults.maxBodyBytes)} au maximum par défaut).`,
    model_not_found: "Vérifiez l'identifiant avec `GET /v1/models` (ou `GET /groq`).",
    not_found: "Vérifiez l'URL et la méthode HTTP (voir la référence).",
    method_not_allowed: "Utilisez l'une des méthodes listées dans l'en-tête `Allow`.",
    rate_limited: "Attendez le délai indiqué par `Retry-After`, puis réessayez. Espacez vos requêtes.",
    upstream_rejected: "Le fournisseur juge la requête invalide (paramètre non pris en charge, valeur hors limites…) : corrigez-la d'après le message.",
    upstream_error: "Panne passagère chez les fournisseurs : réessayez avec un délai croissant. `details` indique la cause pour chaque modèle.",
    upstream_auth_error: "Problème de configuration côté serveur (clé d'un fournisseur refusée) : prévenez l'administrateur en lui donnant le `request_id`.",
    upstream_timeout: "Le modèle imposé n'a pas répondu à temps : réessayez, ou utilisez `auto` pour profiter de la bascule.",
    deadline_exceeded: "Réessayez en demandant une réponse plus courte (`max_tokens`) ou en utilisant le streaming.",
    provider_not_configured: "Les routes `/groq` nécessitent `GROQ_API_KEY` : prévenez l'administrateur, ou utilisez `POST /v1/chat/completions`.",
    no_provider_configured: "Aucun fournisseur n'est activé : prévenez l'administrateur.",
    server_misconfigured: "La passerelle n'a aucune clé d'accès (`GATEWAY_KEYS`) : prévenez l'administrateur.",
    internal_error: "Erreur inattendue : réessayez, puis communiquez le `request_id` à l'administrateur.",
  };
  const missingAdvice = Object.keys(ERRORS).filter((c) => !ADVICE[c]);
  const staleAdvice = Object.keys(ADVICE).filter((c) => !ERRORS[c]);
  if (missingAdvice.length || staleAdvice.length) {
    throw new Error(`Conseils d'erreur désynchronisés — à ajouter : [${missingAdvice}] ; à retirer : [${staleAdvice}]`);
  }

  const errorRows = Object.entries(ERRORS).map(([name, def]) => [
    name === "upstream_rejected" ? tag("4xx", "red") : statusTag(def.status),
    code(name),
    esc(def.message),
    inline(ADVICE[name]),
  ]);

  const retryCode = `async function chat(body, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch("${BASE_URL}/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${process.env.GATEWAY_KEY}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.ok) return response.json();

    const { error } = await response.json();
    const retryable = [429, 502, 504].includes(response.status);
    if (!retryable || attempt >= retries) {
      throw new Error(\`\${error.code} : \${error.message} (requête \${error.request_id})\`);
    }

    // Retry-After si présent, sinon attente croissante : 1 s, 2 s, 4 s…
    const wait = Number(response.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 30) * 1000));
  }
}`;

  const errors = section(
    "erreurs",
    "Erreurs",
    join(
      `<div class="docs-prose">${md("Toutes les erreurs ont le même format JSON, quel que soit l'endroit où elles se produisent. Le `code` est stable : c'est lui que votre programme doit tester. Le `message`, en français, est destiné aux humains.")}</div>`,
      snippet(JSON.stringify(rateLimitedExample, null, 2), "json", { label: "Exemple d'erreur" }),
      table({
        head: ["Champ", "Description"],
        rows: [
          [code("error.code"), inline("Code stable, à utiliser dans votre programme (liste ci-dessous).")],
          [code("error.type"), inline("Catégorie générale : `authentication_error`, `invalid_request_error`, `not_found_error`, `rate_limit_error` ou `api_error`.")],
          [code("error.message"), inline("Explication lisible, en français.")],
          [code("error.param"), inline("Champ de la requête en cause, ou `null`.")],
          [code("error.request_id"), inline("Identifiant de la requête, aussi dans l'en-tête `X-Request-Id`. Communiquez-le en cas de problème : il permet de retrouver la requête dans les journaux.")],
          [code("error.details"), inline("Uniquement quand la bascule a échoué : une entrée par modèle essayé (`provider`, `model`, `status`, `kind`, `message`).")],
        ],
        label: "Champs d'une erreur",
        className: "docs-table--wrap",
      }),
      h3("codes-erreur", "Codes d'erreur"),
      table({ head: ["HTTP", "Code", "Message par défaut", "Que faire ?"], rows: errorRows, label: "Codes d'erreur", className: "docs-table--wrap" }),
      h3("reessayer", "Réessayer correctement"),
      `<div class="docs-prose">${md("- **À réessayer** : `429` (après le délai de `Retry-After`), `502` et `504` — avec une attente croissante.\n- **À ne pas réessayer** : `400`, `401`, `404`, `405`, `413` — la requête elle-même doit être corrigée.\n- `503` indique un problème de configuration côté serveur : inutile de réessayer tant que l'administrateur n'est pas intervenu.")}</div>`,
      snippet(retryCode, "javascript", { base: true, label: "Exemple de nouvelle tentative" }),
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Limites et délais
  // ------------------------------------------------------------------------------------------
  const limits = section(
    "limites",
    "Limites et délais",
    join(
      table({
        head: ["Limite", "Valeur par défaut", "Réglage", "Dépassement"],
        rows: [
          ["Taille du corps de la requête", megabytes(defaults.maxBodyBytes), code("MAX_BODY_BYTES"), `${statusTag(413)} ${code("payload_too_large")}`],
          ["Durée d'une tentative chez un fournisseur", seconds(defaults.timeoutMs), code("TIMEOUT_MS"), inline("Le modèle est abandonné, le suivant est essayé")],
          ["Durée totale d'une requête (tentatives de secours comprises)", seconds(defaults.deadlineMs), code("DEADLINE_MS"), `${statusTag(504)} ${code("deadline_exceeded")}`],
          ["Durée maximale de la fonction sur Vercel", "60 s", `${code("maxDuration")} (vercel.json)`, inline("Selon votre offre Vercel")],
        ],
        label: "Valeurs par défaut des limites",
        className: "docs-table--wrap",
      }),
      `<div class="docs-prose">${md("La durée d'une tentative couvre l'attente de la réponse complète, hors streaming. En streaming, elle ne couvre que l'attente du début de la réponse : une fois le flux commencé, seul le délai total s'applique.")}${md("**Débit.** La passerelle n'impose aucune limite de débit qui lui soit propre : les limites sont celles de vos comptes chez Groq, Google et Cloudflare. Quand elles sont atteintes, la bascule automatique prend le relais (voir [Modèles et routage](#routage)).")}${md("**Modèles à raisonnement.** Certains modèles (`gpt-oss`, Gemini 3, Qwen3…) réfléchissent avant de répondre, et ces jetons de réflexion comptent dans `max_tokens`. Si la limite est trop basse, la réponse est coupée avant d'avoir commencé : le statut reste `200`, mais `content` est vide et `finish_reason` vaut `length`. Évitez de fixer `max_tokens`, laissez au moins 1 000 jetons de marge, ou réduisez la réflexion avec `reasoning_effort: low` (modèles `gpt-oss` de Groq).")}</div>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Référence (générée)
  // ------------------------------------------------------------------------------------------
  const referenceSection = section("reference", "Référence de l'API", join(`<div class="docs-prose">${md("Cette référence est générée à partir de la [spécification OpenAPI 3.1](/openapi.json) de la passerelle : elle est toujours à jour. Importez ce fichier dans Postman, Insomnia ou un générateur de client pour travailler avec votre outil habituel.")}</div>`, reference.referenceHtml()));

  const schemasSection = section("schemas", "Schémas", join(`<div class="docs-prose">${md("Structure des objets échangés avec l'API.")}</div>`, reference.schemasHtml()));

  // ------------------------------------------------------------------------------------------
  //  Terrain de jeu
  // ------------------------------------------------------------------------------------------
  const playground = section(
    "essayer",
    "Essayer l'API",
    join(
      `<div class="docs-prose">${md("Envoyez une vraie requête à cette passerelle depuis votre navigateur. Votre clé n'est envoyée qu'à la passerelle elle-même.")}</div>`,
      `<div class="docs-playground__offline">${notification("warning", "Disponible uniquement en ligne", md("Le terrain de jeu envoie les requêtes à la passerelle qui sert cette page. Ouvrez la documentation depuis l'adresse de votre passerelle (par exemple `https://votre-projet.vercel.app/docs/`) pour l'utiliser."))}</div>`,
      `<form class="docs-playground docs-playground__live" id="pg-form" autocomplete="off" novalidate aria-label="Terrain de jeu"><div class="docs-playground__grid"><div>`,
      textInput({ id: "pg-key", label: "Clé API", type: "password", placeholder: "Votre clé projet", help: "Elle reste dans votre navigateur.", attrs: 'autocomplete="off" spellcheck="false"' }),
      toggle({ id: "pg-remember", label: "Mémoriser la clé pour cet onglet", off: "Non", on: "Oui" }),
      `<div class="docs-pg-models">${select({ id: "pg-model", label: "Modèle", options: [["auto", "auto (bascule automatique)"]] })}${button("Charger la liste", { kind: "tertiary", size: "sm", attrs: 'id="pg-load-models"' })}</div>`,
      `<p class="docs-pg-status" id="pg-models-status" aria-live="polite"></p>`,
      textArea({ id: "pg-system", label: "Message système (facultatif)", rows: 2, placeholder: "" }),
      textArea({ id: "pg-user", label: "Message", rows: 4, value: "Explique en deux phrases ce qu'est une passerelle d'API." }),
      `<div class="docs-pg-row">${textInput({ id: "pg-temperature", label: "Température", type: "number", placeholder: "0 à 2", attrs: 'min="0" max="2" step="0.1"' })}${textInput({ id: "pg-max-tokens", label: "Jetons maximum", type: "number", placeholder: "ex. 256", attrs: 'min="1" step="1"' })}</div>`,
      toggle({ id: "pg-stream", label: "Streaming", off: "Non", on: "Oui", checked: true }),
      `<div class="docs-pg-buttons"><button type="submit" class="cds--btn cds--btn--primary" id="pg-send">Envoyer${icon("send", 16, "cds--btn__icon")}</button><button type="button" class="cds--btn cds--btn--secondary" id="pg-stop" hidden>Arrêter</button></div>`,
      `</div><div>`,
      `<div class="docs-pg-meta" id="pg-meta" aria-live="polite"></div>`,
      `<p class="cds--label">Réponse</p><div class="docs-pg-output is-empty" id="pg-output" role="log" aria-live="polite" aria-label="Réponse du modèle" tabindex="0">La réponse s'affichera ici.</div>`,
      accordion([{ title: "Réponse brute", html: `<pre class="docs-pg-raw" id="pg-raw" tabindex="0"></pre>` }]),
      `<p class="cds--label docs-pg-curl">Requête équivalente</p>`,
      `<div class="cds--snippet cds--snippet--multi docs-snippet"><div class="cds--snippet-container" role="group" tabindex="0" aria-label="Commande curl équivalente"><pre><code id="pg-curl-code" class="hljs"></code></pre></div><div class="docs-snippet__copy">${copyButton("Copier")}</div></div>`,
      `</div></div></form>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Configuration et déploiement
  // ------------------------------------------------------------------------------------------
  const value = (text) => `<code>${esc(text)}</code>`;
  const envRows = [
    ["GATEWAY_KEYS", "**Requis.** Clés autorisées à appeler l'API, séparées par des virgules (une par projet). 16 caractères minimum.", "—"],
    ["GROQ_API_KEY", "Clé de l'API Groq. Vide : Groq est désactivé.", "—"],
    ["GEMINI_API_KEY", "Clé de l'API Google Gemini. Vide : Gemini est désactivé.", "—"],
    ["CLOUDFLARE_API_TOKEN", "Jeton Cloudflare Workers AI. Avec `CLOUDFLARE_ACCOUNT_ID`, active Cloudflare.", "—"],
    ["CLOUDFLARE_ACCOUNT_ID", "Identifiant de compte Cloudflare.", "—"],
    ["GROQ_MODEL", "Modèles Groq à essayer en premier (liste séparée par des virgules). Les autres modèles de chat actifs suivent, du plus grand au plus petit.", value(DEFAULTS.groqModels.join(","))],
    ["GEMINI_MODEL", "Modèles Gemini, essayés dans l'ordre.", value(DEFAULTS.geminiModels.join(","))],
    ["CLOUDFLARE_MODEL", "Modèles Cloudflare, essayés dans l'ordre.", value(DEFAULTS.cloudflareModels.join(","))],
    ["TIMEOUT_MS", "Durée maximale d'une tentative chez un fournisseur (minimum 500).", value(defaults.timeoutMs)],
    ["DEADLINE_MS", "Durée maximale d'une requête, tentatives de secours comprises (minimum 1000). À garder sous `maxDuration`.", value(defaults.deadlineMs)],
    ["MAX_BODY_BYTES", "Taille maximale du corps d'une requête, en octets.", value(defaults.maxBodyBytes)],
    ["CORS_ORIGINS", "Origines autorisées pour les navigateurs, séparées par des virgules.", value("*")],
    ["LOG_LEVEL", "`silent`, `error`, `warn` ou `info`.", value(defaults.logLevel)],
    ["GROQ_BASE_URL, GEMINI_BASE_URL, CLOUDFLARE_BASE_URL", "Pour passer par un proxy ou une passerelle intermédiaire.", "Adresse officielle"],
  ].map(([name, description, def]) => [name.split(", ").map(code).join("<br>"), inline(description), def.startsWith("<") ? def : inline(def)]);

  const configuration = section(
    "configuration",
    "Configuration et déploiement",
    join(
      `<div class="docs-prose">${md("Cette section s'adresse à la personne qui déploie et administre la passerelle.")}</div>`,
      h3("deploiement", "Déployer sur Vercel"),
      `<div class="docs-prose">${md("1. Importez le dépôt GitHub dans Vercel (« Add New… » puis « Project »). Aucune commande de build n'est nécessaire : le dossier de sortie (`public`) et la fonction sont déjà déclarés dans `vercel.json`.\n2. Dans « Settings » puis « Environment Variables », ajoutez au minimum `GATEWAY_KEYS` et une clé de fournisseur (voir le tableau ci-dessous).\n3. Déployez, puis vérifiez `GET /health` et cette page (`/docs/`).")}</div>`,
      h3("local", "Lancer en local"),
      snippet("cp .env.example .env   # puis renseignez les valeurs\nnpm start               # http://localhost:3000", "text", { label: "Lancer en local" }),
      `<div class="docs-prose">${md("Node.js 20.12 ou plus récent est requis. Il n'y a aucune dépendance à installer : `npm start` suffit. Les tests s'exécutent avec `npm test`.")}</div>`,
      h3("variables", "Variables d'environnement"),
      table({ head: ["Variable", "Description", "Valeur par défaut"], rows: envRows, label: "Variables d'environnement", className: "docs-table--wrap" }),
      h3("cles", "Générer une clé solide"),
      snippet("node -e \"console.log(crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''))\"", "bash", { label: "Générer une clé" }),
      `<div class="docs-prose">${md("Donnez une clé différente à chaque projet : vous pourrez en révoquer une sans toucher aux autres. Pour changer de clé, modifiez `GATEWAY_KEYS` puis redéployez. Au démarrage, la passerelle signale dans ses journaux les clés d'exemple ou trop courtes.")}</div>`,
      h3("modeles-par-defaut", "Choisir les modèles"),
      `<div class="docs-prose">${md("Les modèles par défaut ont été vérifiés dans la documentation des fournisseurs le 2 octobre 2026. **Les fournisseurs retirent régulièrement des modèles** : si un identifiant disparaît, la passerelle bascule d'elle-même sur le suivant, mais pensez à mettre à jour `GROQ_MODEL`, `GEMINI_MODEL` et `CLOUDFLARE_MODEL`. Les modèles Groq de chat actifs sont découverts automatiquement ; si `GROQ_MODEL` cite un modèle que Groq ne propose plus, un avertissement est écrit dans les journaux.")}</div>`,
      h3("journaux", "Journaux et sécurité"),
      `<div class="docs-prose">${md("Chaque requête produit une ligne de journal, sans jamais écrire le corps, la clé ni la query string :")}</div>`,
      snippet("[req_3f9a1c7e2b5d4a60] POST /v1/chat/completions 200 812ms groq/openai/gpt-oss-120b clé=9fce2e", "text", { label: "Exemple de ligne de journal" }),
      `<div class="docs-prose">${md("`clé=9fce2e` est une empreinte courte et non réversible de la clé utilisée : elle permet de savoir quel projet appelle, sans exposer la clé.\n\n**Bonnes pratiques :** clés longues et aléatoires, une par projet ; ne jamais committer le fichier `.env` ; restreindre `CORS_ORIGINS` si seule une application web connue appelle la passerelle ; surveiller `GET /health` avec un service de supervision.")}</div>`,
    ),
  );

  // ------------------------------------------------------------------------------------------
  //  Notes de version
  // ------------------------------------------------------------------------------------------
  const releaseNotes = section(
    "versions",
    "Notes de version",
    join(
      `<h3 id="v${esc(VERSION.replaceAll(".", "-"))}">Version ${esc(VERSION)} ${tag("Actuelle", "blue", { size: "sm" })}</h3>`,
      `<div class="docs-prose">${md(
        [
          "- **Ordre des modèles Groq stable** : les modèles qui ne figurent pas dans `GROQ_MODEL` sont désormais classés du plus grand au plus petit. Ils suivaient jusqu'ici l'ordre de la liste renvoyée par Groq, qui change d'une heure à l'autre.",
          "- **Cloudflare Workers AI** : l'erreur « No such model » (HTTP 400) est reconnue comme un modèle introuvable (pause de 10 minutes, `404 model_not_found` en mode forcé), et son message est affiché tel quel au lieu du JSON brut.",
          "- **Journaux** : un avertissement signale les modèles cités dans `GROQ_MODEL` que Groq ne propose plus.",
          "- **Documentation** : nouvelle note sur les modèles à raisonnement et `max_tokens` (réponse vide quand la limite est trop basse).",
        ].join("\n"),
      )}</div>`,
      `<h3 id="v1-1-0">Version 1.1.0</h3>`,
      `<div class="docs-prose">${md(
        [
          "- **Documentation** : cette page (`/docs/`) et la spécification OpenAPI 3.1 (`/openapi.json`).",
          "- **Bascule plus fiable** : pauses par modèle (429, pannes, délais), délai total (`DEADLINE_MS`) avec une réponse `504` en JSON au lieu d'une coupure brutale, délai appliqué aussi aux réponses qui s'arrêtent en route.",
          "- **Streaming robuste** : une coupure du fournisseur produit un événement d'erreur propre ; la fermeture de la connexion annule l'appel au fournisseur.",
          "- **Erreurs normalisées** : `code`, `type`, `param`, `request_id` et `details`, avec des statuts HTTP justes (la clé refusée par un fournisseur n'apparaît plus comme une erreur d'authentification du client).",
          "- **Sécurité** : `GET /` ne révèle plus les fournisseurs sans clé valide ; comparaison des clés en temps constant ; avertissements pour les clés faibles ; CORS configurable ; les fichiers du dépôt ne sont plus exposés (dossier `public/`).",
          "- **Corrections** : une URL mal encodée sous `/groq/…` ne fait plus tomber le serveur ; les accents coupés entre deux paquets réseau ne sont plus corrompus ; le message d'un refus cite le bon fournisseur.",
          "- **Modèles par défaut** mis à jour (plusieurs anciens modèles étaient retirés).",
        ].join("\n"),
      )}</div>`,
    ),
  );

  return {
    sections: [introduction, quickstart, authentication, routing, streaming, errors, limits, referenceSection, schemasSection, playground, configuration, releaseNotes].join(""),
  };
}

// ---------------------------------------------------------------------------------------------
//  Menu latéral
// ---------------------------------------------------------------------------------------------
export function navigation(reference) {
  const link = (id, text) => `<li class="cds--side-nav__item"><a class="cds--side-nav__link" href="#${id}"><span class="cds--side-nav__link-text">${prose(text)}</span></a></li>`;
  // Chaque groupe est une liste imbriquée nommée par son intitulé (HTML valide, lisible par les lecteurs d'écran).
  let groupId = 0;
  const group = (title, ...items) => {
    const id = `nav-group-${++groupId}`;
    return `<li class="docs-nav-section"><span class="docs-nav-group" id="${id}">${prose(title)}</span><ul aria-labelledby="${id}">${join(items)}</ul></li>`;
  };
  const endpoint = ({ id, method, path }) =>
    `<li class="cds--side-nav__item"><a class="cds--side-nav__link docs-nav-endpoint" href="#${id}"><span class="docs-method docs-method--${method.toLowerCase()}">${method}</span><span class="cds--side-nav__link-text">${esc(path)}</span></a></li>`;
  return join(
    group("Prise en main", link("introduction", "Introduction"), link("demarrage", "Démarrage rapide"), link("authentification", "Authentification")),
    group("Guides", link("routage", "Modèles et routage"), link("streaming", "Streaming (SSE)"), link("erreurs", "Erreurs"), link("limites", "Limites et délais")),
    group("Référence", link("reference", "Référence de l'API"), reference.navEntries().map(endpoint), link("schemas", "Schémas")),
    group("Outils", link("essayer", "Essayer l'API")),
    group("Administration", link("configuration", "Configuration et déploiement"), link("versions", "Notes de version")),
  );
}

