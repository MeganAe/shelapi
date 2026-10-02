// =====================================================================
//  Utilitaires HTTP : erreurs normalisées, réponses JSON, CORS,
//  lecture sécurisée du corps, authentification par clé.
// =====================================================================
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------
//  Catalogue des erreurs — source unique pour le code, la doc et les tests.
//  Format de réponse : { error: { message, type, code, param, request_id } }
// ---------------------------------------------------------------------
export const ERRORS = Object.freeze({
  missing_api_key: { status: 401, type: "authentication_error", message: "Clé API manquante : envoyez l'en-tête « Authorization: Bearer <clé> »." },
  invalid_api_key: { status: 401, type: "authentication_error", message: "Clé API invalide." },
  invalid_json: { status: 400, type: "invalid_request_error", message: "Le corps de la requête doit être un objet JSON valide." },
  invalid_request: { status: 400, type: "invalid_request_error", message: "Requête invalide." },
  payload_too_large: { status: 413, type: "invalid_request_error", message: "Corps de la requête trop volumineux." },
  model_not_found: { status: 404, type: "not_found_error", message: "Modèle introuvable." },
  not_found: { status: 404, type: "not_found_error", message: "Route introuvable." },
  method_not_allowed: { status: 405, type: "invalid_request_error", message: "Méthode non autorisée pour cette route." },
  rate_limited: { status: 429, type: "rate_limit_error", message: "Limite de débit atteinte chez les fournisseurs : réessayez plus tard." },
  // Le statut réel est celui du fournisseur (400, 404, 422…) : la requête elle-même est en cause.
  upstream_rejected: { status: 400, type: "invalid_request_error", message: "Le fournisseur a refusé la requête." },
  upstream_error: { status: 502, type: "api_error", message: "Tous les fournisseurs ont échoué." },
  upstream_auth_error: { status: 502, type: "api_error", message: "Le fournisseur a refusé la clé configurée sur la passerelle (vérifiez les variables d'environnement)." },
  upstream_timeout: { status: 504, type: "api_error", message: "Le fournisseur n'a pas répondu à temps." },
  deadline_exceeded: { status: 504, type: "api_error", message: "Délai maximal de la requête dépassé." },
  provider_not_configured: { status: 503, type: "api_error", message: "Ce fournisseur n'est pas configuré sur la passerelle." },
  no_provider_configured: { status: 503, type: "api_error", message: "Aucun fournisseur n'est configuré sur la passerelle." },
  server_misconfigured: { status: 503, type: "api_error", message: "La passerelle n'a aucune clé d'accès configurée (variable GATEWAY_KEYS)." },
  internal_error: { status: 500, type: "api_error", message: "Erreur interne de la passerelle." },
});

export class GatewayError extends Error {
  constructor(code, message, { status, param = null, headers = {}, details } = {}) {
    const def = ERRORS[code] ?? ERRORS.internal_error;
    super(message ?? def.message);
    this.name = "GatewayError";
    this.code = ERRORS[code] ? code : "internal_error";
    this.type = def.type;
    this.status = status ?? def.status;
    this.param = param;
    this.headers = headers;
    this.details = details;
  }
}

// ---------------------------------------------------------------------
//  Réponses
// ---------------------------------------------------------------------
export function sendJson(res, status, data, headers = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

export function sendError(res, err, requestId) {
  const error = {
    message: err.message,
    type: err.type,
    code: err.code,
    param: err.param ?? null,
    request_id: requestId,
  };
  if (err.details) error.details = err.details;
  const headers = { ...err.headers };
  if (err.code === "payload_too_large") headers.Connection = "close"; // on n'attend pas la fin de l'envoi
  sendJson(res, err.status, { error }, headers);
}

// ---------------------------------------------------------------------
//  Identifiant de requête (repris du client s'il est raisonnable)
// ---------------------------------------------------------------------
export function requestId(req) {
  const given = String(req.headers["x-request-id"] ?? "");
  return /^[\w.-]{8,64}$/.test(given) ? given : `req_${randomBytes(8).toString("hex")}`;
}

// ---------------------------------------------------------------------
//  URL publique de la passerelle (derrière le proxy de Vercel)
// ---------------------------------------------------------------------
export function originFrom(req) {
  const first = (v) => String(v ?? "").split(",")[0].trim();
  const forwardedProto = first(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.socket?.encrypted ? "https" : "http";
  const host = first(req.headers["x-forwarded-host"]) || first(req.headers.host);
  return /^[a-z0-9.\-:[\]]+$/i.test(host) ? `${proto}://${host}` : "http://localhost";
}

// ---------------------------------------------------------------------
//  CORS (CORS_ORIGINS = "*" par défaut, ou une liste d'origines autorisées)
// ---------------------------------------------------------------------
export function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else {
    res.setHeader("Vary", "Origin");
    if (origin && allowedOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key, X-Request-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Sans cette ligne, un navigateur ne peut pas lire X-Provider, X-Model, etc.
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-Provider, X-Model, Retry-After");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---------------------------------------------------------------------
//  Lecture du corps JSON
//  - Sur Vercel, req.body est déjà analysé (et son accès peut lever une erreur).
//  - En local, on lit le flux en octets (et pas en texte : les accents coupés
//    entre deux paquets seraient corrompus).
// ---------------------------------------------------------------------
function parseJsonObject(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new GatewayError("invalid_json");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new GatewayError("invalid_json");
  return value;
}

export async function readJsonBody(req, maxBytes) {
  let preParsed;
  try {
    preParsed = req.body;
  } catch {
    throw new GatewayError("invalid_json");
  }

  if (preParsed !== undefined && preParsed !== null) {
    if (Buffer.isBuffer(preParsed) || typeof preParsed === "string") {
      const text = Buffer.isBuffer(preParsed) ? preParsed.toString("utf8") : preParsed;
      if (Buffer.byteLength(text) > maxBytes) throw new GatewayError("payload_too_large");
      return parseJsonObject(text);
    }
    if (typeof preParsed === "object" && !Array.isArray(preParsed)) return preParsed;
    throw new GatewayError("invalid_json");
  }

  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw new GatewayError("payload_too_large");

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new GatewayError("payload_too_large");
      chunks.push(chunk);
    }
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError("invalid_request", "Lecture de la requête interrompue.");
  }
  return parseJsonObject(Buffer.concat(chunks).toString("utf8"));
}

// ---------------------------------------------------------------------
//  Authentification par clé projet
//  Comparaison en temps constant (hash SHA-256 + timingSafeEqual), sans sortie anticipée.
// ---------------------------------------------------------------------
const sha256 = (s) => createHash("sha256").update(s).digest();

export function createAuthenticator(keys) {
  const digests = keys.map(sha256);
  return function authenticate(req) {
    const header = String(req.headers.authorization ?? "").trim();
    const bearer = /^Bearer\s+(.+)$/i.exec(header);
    const token = (bearer ? bearer[1] : String(req.headers["x-api-key"] ?? "")).trim();
    if (!token) return { ok: false, code: "missing_api_key" };

    const candidate = sha256(token);
    let found = -1;
    digests.forEach((digest, i) => {
      if (timingSafeEqual(digest, candidate)) found = i;
    });
    if (found === -1) return { ok: false, code: "invalid_api_key" };
    // Empreinte courte et non réversible, utile pour savoir quel projet appelle (logs).
    return { ok: true, keyId: digests[found].toString("hex").slice(0, 6) };
  };
}

/** Retire des textes renvoyés par les fournisseurs ce qui ressemble à une clé ou à un identifiant d'organisation. */
export function redact(text) {
  return String(text ?? "")
    .replace(/\b(gsk_|sk-|AIza|org_|cfut_)[A-Za-z0-9_-]{6,}/g, "$1…")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer …");
}
