// =====================================================================
//  AI GATEWAY — version Vercel (fonction serverless)
//  Routes : GET /  |  GET /v1/models  |  POST /v1/chat/completions
//           GET /groq  |  POST /groq/<modèle>
//  Voir README.md pour le déploiement.
// =====================================================================
import { Readable } from "node:stream";

try { process.loadEnvFile(); } catch { /* pas de .env : on utilise l'environnement */ }

const env = process.env;
const GATEWAY_KEYS = (env.GATEWAY_KEYS || "").split(",").map((s) => s.trim()).filter(Boolean);
const TIMEOUT_MS = Number(env.TIMEOUT_MS) || 20000;

// --- Fournisseurs (tous exposent un endpoint compatible OpenAI) ---
const providers = [
  {
    name: "groq",
    enabled: () => !!env.GROQ_API_KEY,
    url: () => "https://api.groq.com/openai/v1/chat/completions",
    key: () => env.GROQ_API_KEY,
    defaultModel: () => env.GROQ_MODEL || "llama-3.3-70b-versatile",
  },
  {
    name: "gemini",
    enabled: () => !!env.GEMINI_API_KEY,
    url: () => "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: () => env.GEMINI_API_KEY,
    defaultModel: () => env.GEMINI_MODEL || "gemini-2.5-flash",
  },
  {
    name: "cloudflare",
    enabled: () => !!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID,
    url: () => `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`,
    key: () => env.CLOUDFLARE_API_TOKEN,
    defaultModel: () => env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct",
  },
];

const enabledProviders = () => providers.filter((p) => p.enabled());

// --- Modèles Groq : liste récupérée automatiquement depuis l'API (cache 1 h) ---
const NON_CHAT = /whisper|tts|orpheus|guard|embed|moderation/i;
let groqCache = { at: 0, ids: [] };

async function groqModels() {
  const first = env.GROQ_MODEL || "llama-3.3-70b-versatile";
  if (groqCache.ids.length && Date.now() - groqCache.at < 3600_000) return groqCache.ids;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { data } = await r.json();
    const ids = data
      .filter((m) => m.active !== false && !NON_CHAT.test(m.id))
      .map((m) => m.id)
      .sort((a, b) => (b === first) - (a === first)); // modèle préféré en premier
    groqCache = { at: Date.now(), ids };
    console.log(`[groq] ${ids.length} modèles chargés : ${ids.join(", ")}`);
    return ids;
  } catch (e) {
    console.warn(`[groq] liste des modèles indisponible (${e.message})`);
    return groqCache.ids.length ? groqCache.ids : [first];
  }
}

// --- Pause temporaire d'un modèle qui a atteint sa limite (429) ---
const cooldown = new Map();
const isCooling = (key) => (cooldown.get(key) || 0) > Date.now();

async function expand(p) {
  const models = p.name === "groq" ? await groqModels() : [p.defaultModel()];
  return models.map((m) => ({ p, model: m }));
}

// "auto" | "groq" (tous les modèles Groq) | "groq/<modèle>" | "gemini" | "cloudflare/@cf/..."
async function resolveChain(model) {
  const enabled = enabledProviders();
  const auto = async () => (await Promise.all(enabled.map(expand))).flat();
  if (!model || model === "auto") return auto();
  const [name, ...rest] = model.split("/");
  const p = enabled.find((x) => x.name === name);
  if (!p) return auto();
  if (rest.length) return [{ p, model: rest.join("/") }];
  return expand(p);
}

// --- Authentification par clé projet ---
function authorized(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return GATEWAY_KEYS.includes(token);
}

// --- Utilitaires HTTP ---
function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
    if (typeof req.body === "string") return Promise.resolve(req.body);
    return Promise.resolve(JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) { reject(new Error("Corps trop volumineux")); req.destroy(); }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// --- Logique principale : essayer chaque fournisseur à tour de rôle ---
async function handleChat(req, res, forcedChain) {
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { return sendJson(res, 400, { error: { message: "JSON invalide" } }); }

  if (!Array.isArray(body?.messages)) {
    return sendJson(res, 400, { error: { message: "Champ 'messages' requis" } });
  }

  const chain = forcedChain || await resolveChain(body.model);
  if (!chain.length) {
    return sendJson(res, 503, { error: { message: "Aucun fournisseur configuré" } });
  }

  const errors = [];
  for (const { p, model } of chain) {
    const ck = `${p.name}/${model}`;
    if (chain.length > 1 && isCooling(ck)) continue; // modèle en pause
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS); // timeout jusqu'aux en-têtes
    try {
      const upstream = await fetch(p.url(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key()}` },
        body: JSON.stringify({ ...body, model }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (upstream.ok) {
        console.log(`[ok] ${p.name} (${model})`);
        if (body.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Provider": p.name,
          });
          Readable.fromWeb(upstream.body).pipe(res);
          return;
        }
        return sendJson(res, 200, await upstream.json(), { "X-Provider": p.name });
      }

      const detail = (await upstream.text()).slice(0, 200);
      console.warn(`[échec] ${ck} -> ${upstream.status}`);
      if (upstream.status === 429) {
        const wait = Number(upstream.headers.get("retry-after")) || 60;
        cooldown.set(ck, Date.now() + wait * 1000);
      } else if (upstream.status === 404) {
        cooldown.set(ck, Date.now() + 600_000);
      }
      errors.push({ provider: p.name, model, status: upstream.status, detail });
    } catch (e) {
      clearTimeout(timer);
      console.warn(`[échec] ${ck} -> ${e.message}`);
      errors.push({ provider: p.name, error: e.message });
    }
  }

  if (chain.length === 1 && errors[0]?.status) {
    const e = errors[0];
    return sendJson(res, e.status, { error: { message: `Groq a refusé la requête (${e.status})`, model: e.model, detail: e.detail } });
  }
  if (!errors.length) {
    return sendJson(res, 429, { error: { message: "Tous les modèles sont en pause (limites atteintes), réessaie dans un instant" } });
  }
  sendJson(res, 502, { error: { message: "Tous les fournisseurs ont échoué", details: errors } });
}

// --- Handler Vercel ---
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const path = new URL(req.url, "http://localhost").pathname;

  if (req.method === "GET" && path === "/") {
    return sendJson(res, 200, { status: "ok", providers: enabledProviders().map((p) => p.name) });
  }

  // --- Un endpoint par modèle Groq : POST /groq/<modèle> ---
  if (path === "/groq" || path.startsWith("/groq/")) {
    if (!authorized(req)) return sendJson(res, 401, { error: { message: "Clé API invalide" } });
    const groq = providers.find((p) => p.name === "groq");
    if (!groq.enabled()) return sendJson(res, 503, { error: { message: "GROQ_API_KEY non configurée" } });
    const models = await groqModels();

    if (req.method === "GET" && (path === "/groq" || path === "/groq/")) {
      const base = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
      return sendJson(res, 200, {
        provider: "groq",
        count: models.length,
        models: models.map((id) => ({ id, endpoint: `${base}/groq/${id}` })),
      });
    }

    if (req.method === "POST") {
      const model = decodeURIComponent(path.slice("/groq/".length))
        .replace(/\/(v1\/)?chat\/completions\/?$/, "")
        .replace(/\/$/, "");
      if (!models.includes(model)) {
        return sendJson(res, 404, { error: { message: `Modèle Groq inconnu : ${model}`, hint: "GET /groq pour la liste des endpoints" } });
      }
      return handleChat(req, res, [{ p: groq, model }]);
    }
  }

  if (path.startsWith("/v1/")) {
    if (!authorized(req)) {
      return sendJson(res, 401, { error: { message: "Clé API invalide" } });
    }

    if (req.method === "GET" && path === "/v1/models") {
      const all = (await Promise.all(enabledProviders().map(expand))).flat();
      const data = all.map(({ p, model }) => ({ id: `${p.name}/${model}`, object: "model", owned_by: p.name }));
      return sendJson(res, 200, {
        object: "list",
        data: [{ id: "auto", object: "model", owned_by: "gateway" }, ...data],
      });
    }

    if (req.method === "POST" && path === "/v1/chat/completions") {
      return handleChat(req, res);
    }
  }

  sendJson(res, 404, { error: { message: "Route introuvable" } });
}
