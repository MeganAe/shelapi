// Petits utilitaires HTML partagés par le générateur de la documentation.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Échappe un texte pour l'insérer dans du HTML (contenu ou attribut). */
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Apostrophe typographique entre deux lettres : l'API -> l’API (pour les titres, menus et libellés). */
export const curly = (text) => String(text).replace(/(\p{L})'(\p{L})/gu, "$1\u2019$2");

/** Texte échappé + apostrophes typographiques. */
export const prose = (text) => esc(curly(text));

/** Identifiant d'ancre : « Démarrage rapide » -> « demarrage-rapide ». */
export const slug = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Assemble des fragments en ignorant les valeurs vides (false, null, undefined). */
export const join = (...parts) => parts.flat(Infinity).filter((p) => p !== false && p != null && p !== "").join("");

/** Espace insécable avant « : ; ! ? » et à l'intérieur des guillemets français (typographie française). */
export const typo = (html) =>
  html
    .replace(/ ([:;!?»])/g, "\u00a0$1")
    .replace(/« /g, "«\u00a0")
    .replace(/(\p{L})&#39;(\p{L})/gu, "$1\u2019$2"); // l'API -> l’API (apostrophe typographique)
