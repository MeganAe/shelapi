// =====================================================================
//  AI GATEWAY — routeur principal (fonction serverless Vercel ou serveur Node)
//
//  Routes :
//    GET  /                     statut (JSON) ou redirection vers la doc (navigateur)
//    GET  /health               sonde de disponibilité
//    GET  /docs/                documentation (fichier statique de public/)
//    GET  /openapi.json         spécification OpenAPI 3.1
//    GET  /v1/models            liste des modèles                       (clé requise)
//    POST /v1/chat/completions  chat compatible OpenAI                  (clé requise)
//    GET  /groq                 liste des endpoints Groq                (clé requise)
//    POST /groq/<modèle>        un endpoint par modèle Groq, sans bascule (clé requise)
// =====================================================================
import { createChat } from "./chat.js";
import { loadConfig } from "./config.js";
import {
  GatewayError,
  applyCors,
  createAuthenticator,
  originFrom,
  readJsonBody,
  requestId,
  sendError,
  sendJson,
} from "./http.js";
import { buildOpenApi } from "./openapi.js";
import { createProviders } from "./providers.js";
import { SERVICE_NAME, VERSION } from "./version.js";

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3 };

export function createLogger(level = "info", sink = console) {
  const max = LEVELS[level] ?? LEVELS.info;
  return {
    info: (m) => max >= LEVELS.info && sink.log(m),
    warn: (m) => max >= LEVELS.warn && sink.warn(m),
    error: (m) => max >= LEVELS.error && sink.error(m),
  };
}

const addVary = (res, value) => {
  const current = res.getHeader("Vary");
  res.setHeader("Vary", current ? `${current}, ${value}` : value);
};

/** Vérifie le corps d'une requête de chat avant de déranger un fournisseur. */
export function validateChatBody(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new GatewayError("invalid_request", "Le champ « messages » est requis : un tableau non vide.", { param: "messages" });
  }
  const bad = body.messages.findIndex((m) => !m || typeof m !== "object" || typeof m.role !== "string");
  if (bad !== -1) {
    throw new GatewayError("invalid_request", `messages[${bad}] doit être un objet avec un champ « role » (texte).`, { param: `messages[${bad}]` });
  }
  if (body.model !== undefined && body.model !== null && typeof body.model !== "string") {
    throw new GatewayError("invalid_request", "Le champ « model » doit être un texte.", { param: "model" });
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new GatewayError("invalid_request", "Le champ « stream » doit être un booléen (true ou false).", { param: "stream" });
  }
}

/**
 * Crée le gestionnaire de requêtes.
 * Les dépendances (env, fetch, horloge, logger) sont injectables : c'est ce qui rend les tests possibles.
 */
export function createHandler({ env = process.env, fetch = globalThis.fetch, now = Date.now, log } = {}) {
  const config = loadConfig(env);
  const logger = log ?? createLogger(config.logLevel);
  const providers = createProviders({ config, fetch, now, log: logger });
  const chat = createChat({ config, providers, fetch, now, log: logger });
  const authenticate = createAuthenticator(config.gatewayKeys);
  const startedAt = now();

  for (const warning of config.warnings) logger.warn(`[config] ${warning}`);

  // ----------------------------- Routes -----------------------------
  const home = (req, res) => {
    addVary(res, "Accept");
    if (/\btext\/html\b/i.test(String(req.headers.accept ?? ""))) {
      res.writeHead(302, { Location: "/docs/", "Cache-Control": "no-store" });
      return res.end();
    }
    const body = { status: "ok", service: SERVICE_NAME, version: VERSION, docs: `${originFrom(req)}/docs/` };
    if (authenticate(req).ok) body.providers = providers.enabled().map((p) => p.name); // pas de fuite sans clé
    sendJson(res, 200, body);
  };

  const health = (req, res) => sendJson(res, 200, { status: "ok", version: VERSION, uptime_s: Math.floor((now() - startedAt) / 1000) });

  const docsRedirect = (req, res) => {
    res.writeHead(302, { Location: "/docs/", "Cache-Control": "no-store" });
    res.end();
  };

  const openapi = (req, res) =>
    sendJson(res, 200, buildOpenApi({ serverUrl: originFrom(req) }), { "Cache-Control": "public, max-age=300" });

  const listModels = async (req, res) => {
    const all = (await Promise.all(providers.enabled().map(providers.expand))).flat();
    const created = Math.floor(startedAt / 1000);
    sendJson(res, 200, {
      object: "list",
      data: [
        { id: "auto", object: "model", created, owned_by: "gateway" },
        ...all.map(({ provider, model }) => ({ id: `${provider.name}/${model}`, object: "model", created, owned_by: provider.name })),
      ],
    });
  };

  const chatCompletions = async (req, res, ctx) => {
    const body = await readJsonBody(req, config.maxBodyBytes);
    validateChatBody(body);
    const { chain, forced } = await providers.resolveChain(body.model);
    await chat.run({ res, ctx, body, chain, forced });
  };

  const requireGroq = () => {
    const groq = providers.byName("groq");
    if (!groq.enabled) throw new GatewayError("provider_not_configured", "GROQ_API_KEY n'est pas configurée sur la passerelle.");
    return groq;
  };

  const listGroq = async (req, res) => {
    requireGroq();
    const models = await providers.groqModels();
    const base = originFrom(req);
    sendJson(res, 200, { provider: "groq", count: models.length, models: models.map((id) => ({ id, endpoint: `${base}/groq/${id}` })) });
  };

  const groqModelChat = async (req, res, ctx, { path }) => {
    const groq = requireGroq();
    let model;
    try {
      model = decodeURIComponent(path.slice("/groq/".length)); // peut lever URIError si l'URL est mal encodée
    } catch {
      throw new GatewayError("invalid_request", "Identifiant de modèle mal encodé dans l'URL.", { param: "model" });
    }
    model = model.replace(/\/(v1\/)?chat\/completions$/, "").replace(/\/+$/, "");

    const models = await providers.groqModels();
    if (!models.includes(model)) {
      throw new GatewayError("model_not_found", `Modèle Groq inconnu : ${model}. Utilisez GET /groq pour la liste des endpoints.`, { param: "model" });
    }
    const body = await readJsonBody(req, config.maxBodyBytes);
    validateChatBody(body);
    await chat.run({ res, ctx, body, chain: [{ provider: groq, model }], forced: true });
  };

  const routes = [
    { path: "/", methods: ["GET", "HEAD"], run: home },
    { path: "/health", methods: ["GET", "HEAD"], run: health, quiet: true },
    { path: "/docs", methods: ["GET", "HEAD"], run: docsRedirect },
    { path: "/openapi.json", methods: ["GET", "HEAD"], run: openapi },
    { path: "/v1/models", methods: ["GET"], auth: true, run: listModels },
    { path: "/v1/chat/completions", methods: ["POST"], auth: true, run: chatCompletions },
    { path: "/groq", methods: ["GET"], auth: true, run: listGroq },
  ];
  const groqModelRoute = { methods: ["POST"], auth: true, run: groqModelChat };

  const matchRoute = (path) => routes.find((r) => r.path === path) ?? (path.startsWith("/groq/") ? groqModelRoute : null);

  // --------------------------- Aiguillage ---------------------------
  async function route(req, res, ctx) {
    const rawPath = String(req.url ?? "/").split(/[?#]/)[0];
    if (!rawPath.startsWith("/")) throw new GatewayError("invalid_request", "URL invalide.");
    const path = rawPath.replace(/\/+$/, "") || "/";
    ctx.path = path; // sans la query string : elle pourrait contenir des secrets

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Content-Length": 0 });
      return res.end();
    }

    const matched = matchRoute(path);
    if (!matched) throw new GatewayError("not_found");
    if (!matched.methods.includes(req.method)) {
      throw new GatewayError("method_not_allowed", undefined, { headers: { Allow: [...matched.methods, "OPTIONS"].join(", ") } });
    }
    ctx.quiet = matched.quiet;

    if (matched.auth) {
      if (!config.gatewayKeys.length) throw new GatewayError("server_misconfigured");
      const auth = authenticate(req);
      if (!auth.ok) throw new GatewayError(auth.code, undefined, { headers: { "WWW-Authenticate": 'Bearer realm="ai-gateway"' } });
      ctx.keyId = auth.keyId;
    }
    return matched.run(req, res, ctx, { path });
  }

  function logAccess(ctx, res) {
    if (ctx.quiet) return;
    const parts = [`[${ctx.id}]`, ctx.method, ctx.path, res.statusCode, `${now() - ctx.startedAt}ms`];
    if (ctx.provider) parts.push(`${ctx.provider}/${ctx.model}`);
    if (ctx.attempts > 1) parts.push(`tentatives=${ctx.attempts}`);
    if (ctx.keyId) parts.push(`clé=${ctx.keyId}`);
    if (!res.writableFinished) parts.push("(interrompu)");
    logger.info(parts.join(" "));
  }

  // --------------- Point d'entrée : ne doit JAMAIS laisser une exception s'échapper ---------------
  async function handler(req, res) {
    const ctx = { id: requestId(req), startedAt: now(), method: req.method, path: "-" };
    try {
      res.setHeader("X-Request-Id", ctx.id);
      applyCors(req, res, config.corsOrigins);
      res.once("close", () => logAccess(ctx, res));
      await route(req, res, ctx);
    } catch (e) {
      let error = e;
      if (!(e instanceof GatewayError)) {
        logger.error(`[${ctx.id}] erreur inattendue : ${e?.stack ?? e}`);
        error = new GatewayError("internal_error");
      }
      if (res.headersSent) {
        if (!res.writableEnded) res.end(); // flux déjà commencé : on ferme proprement
      } else {
        sendError(res, error, ctx.id);
      }
    }
  }

  // Exposés pour les tests et le diagnostic.
  handler.config = config;
  handler.providers = providers;
  return handler;
}
