// =====================================================================
//  Configuration : lecture et validation des variables d'environnement
//  (lue au démarrage de la fonction, pas à l'import → facile à tester)
// =====================================================================

// Modèles par défaut, vérifiés dans la documentation officielle des fournisseurs
// le 2 octobre 2026. Ils changent souvent : surchargez-les avec GROQ_MODEL,
// GEMINI_MODEL et CLOUDFLARE_MODEL (listes séparées par des virgules).
export const DEFAULTS = Object.freeze({
  groqModels: ["openai/gpt-oss-120b"],
  geminiModels: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
  cloudflareModels: ["@cf/meta/llama-3.1-8b-instruct-fp8"],
});

// Valeurs d'exemple publiées dans l'ancien .env.example : à ne jamais utiliser en production.
const SAMPLE_KEYS = new Set(["cle-projet-1", "cle-projet-2", "change-me", "changeme"]);
const MIN_KEY_LENGTH = 16;

const trimSlash = (s) => String(s).replace(/\/+$/, "");

/** "a, b ,,c" -> ["a","b","c"] (ou `fallback` si la liste est vide) */
export function parseList(value, fallback = []) {
  const items = String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

/** Nombre entier borné ; retourne `fallback` si la valeur est absente ou invalide. */
export function parseInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(Math.floor(n), max);
}

export function loadConfig(env = process.env) {
  const text = (name) => String(env[name] ?? "").trim();
  const cfAccount = text("CLOUDFLARE_ACCOUNT_ID");

  const providers = [
    {
      name: "groq",
      apiKey: text("GROQ_API_KEY"),
      baseUrl: trimSlash(text("GROQ_BASE_URL") || "https://api.groq.com/openai/v1"),
      models: parseList(env.GROQ_MODEL, DEFAULTS.groqModels), // modèles préférés (placés en premier)
      discover: true, // la liste complète est récupérée automatiquement via l'API
    },
    {
      name: "gemini",
      apiKey: text("GEMINI_API_KEY"),
      baseUrl: trimSlash(text("GEMINI_BASE_URL") || "https://generativelanguage.googleapis.com/v1beta/openai"),
      models: parseList(env.GEMINI_MODEL, DEFAULTS.geminiModels),
      discover: false,
    },
    {
      name: "cloudflare",
      apiKey: text("CLOUDFLARE_API_TOKEN"),
      baseUrl: trimSlash(
        text("CLOUDFLARE_BASE_URL") ||
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccount)}/ai/v1`,
      ),
      models: parseList(env.CLOUDFLARE_MODEL, DEFAULTS.cloudflareModels),
      discover: false,
      needsAccount: true,
    },
  ].map((p) => ({ ...p, enabled: Boolean(p.apiKey) && (!p.needsAccount || Boolean(cfAccount)) }));

  const gatewayKeys = parseList(env.GATEWAY_KEYS);

  const warnings = [];
  for (const key of gatewayKeys) {
    if (SAMPLE_KEYS.has(key.toLowerCase())) {
      warnings.push(`GATEWAY_KEYS contient la valeur d'exemple « ${key} » : n'importe qui peut la deviner. Générez une vraie clé.`);
    } else if (key.length < MIN_KEY_LENGTH) {
      warnings.push(`Une clé de GATEWAY_KEYS fait moins de ${MIN_KEY_LENGTH} caractères : utilisez une clé longue et aléatoire.`);
    }
  }
  if (!gatewayKeys.length) warnings.push("GATEWAY_KEYS est vide : toutes les requêtes authentifiées seront refusées (503).");
  if (!providers.some((p) => p.enabled)) warnings.push("Aucun fournisseur configuré (GROQ_API_KEY, GEMINI_API_KEY ou CLOUDFLARE_*).");

  const origins = parseList(env.CORS_ORIGINS, ["*"]);

  return Object.freeze({
    gatewayKeys,
    providers: Object.freeze(providers),
    // Délai maximal d'UNE tentative chez un fournisseur (jusqu'à la réponse complète, hors streaming).
    timeoutMs: parseInteger(env.TIMEOUT_MS, 20_000, { min: 500, max: 300_000 }),
    // Budget total d'une requête, tentatives de secours comprises. À garder sous maxDuration (vercel.json).
    deadlineMs: parseInteger(env.DEADLINE_MS, 50_000, { min: 1_000, max: 300_000 }),
    maxBodyBytes: parseInteger(env.MAX_BODY_BYTES, 4 * 1024 * 1024, { min: 1_024, max: 50 * 1024 * 1024 }),
    corsOrigins: origins,
    logLevel: text("LOG_LEVEL").toLowerCase() || "info",
    warnings: Object.freeze(warnings),
  });
}
