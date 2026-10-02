// =====================================================================
//  Chat : essaie chaque fournisseur à tour de rôle (bascule automatique),
//  gère le streaming SSE, les délais et les pauses après erreur.
// =====================================================================
import { GatewayError, redact, sendJson } from "./http.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// Durée de pause selon la cause de l'échec
export const COOLDOWN = {
  serverMs: 30_000, // 5xx, délai dépassé, réseau : disjoncteur court
  authMs: 300_000, // clé du fournisseur refusée
  unavailableMs: 600_000, // modèle retiré / inconnu
  defaultRateLimitS: 60,
  maxRateLimitS: 3_600,
};
const MIN_ATTEMPT_MS = 250; // inutile de lancer une tentative s'il reste moins de temps

/** Retry-After : secondes ou date HTTP ; à défaut, délai suggéré par Gemini dans le corps de l'erreur. */
export function parseRetryAfter(headerValue, bodyText = "", now = Date.now) {
  const raw = String(headerValue ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.ceil(Number(raw));
  // Date HTTP (« Fri, 02 Oct 2026 12:01:00 GMT »). On exige la forme « jour, … » car Date.parse est
  // très tolérant (pour V8, « -5 » est une date valide) : une valeur absurde ne doit pas passer pour une date.
  if (/^[A-Za-z]{3,9},\s/.test(raw)) {
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - now()) / 1000));
  }
  const hint = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(bodyText);
  return hint ? Math.ceil(Number(hint[1])) : null;
}

/** Détermine la cause d'un échec HTTP d'un fournisseur. */
export function classifyFailure(status, code, message) {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  // « No such model » : formulation de Cloudflare Workers AI (HTTP 400, code 5007), relevée sur un déploiement réel.
  const gone = /decommission|no longer (available|supported)|no such model|model[^.]{0,40}(does not exist|not found|not supported)/i;
  if (status === 404 || status === 410 || /decommission|model_not_found|model_deprecated/i.test(code) || (status === 400 && gone.test(message))) {
    return "model_unavailable";
  }
  if (status >= 500) return "server";
  return "client"; // 400, 413, 422… : la requête elle-même est en cause
}

const waitForDrain = (res) =>
  new Promise((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.once("drain", done);
    res.once("close", done);
  });

export function createChat({ config, providers, fetch, now = Date.now, log }) {
  /** Une tentative = un AbortController relié au délai d'essai, au délai global et à la déconnexion du client. */
  function newAttempt(deadlineAt, clientSignal) {
    const controller = new AbortController();
    let reason = null;
    const abort = (why) => {
      if (reason) return;
      reason = why;
      controller.abort();
    };
    const attemptTimer = setTimeout(() => abort("timeout"), Math.min(config.timeoutMs, Math.max(1, deadlineAt - now())));
    const deadlineTimer = setTimeout(() => abort("deadline"), Math.max(1, deadlineAt - now()));
    const onClient = () => abort("client");
    clientSignal.addEventListener("abort", onClient, { once: true });
    return {
      signal: controller.signal,
      get reason() {
        return reason;
      },
      // Le délai d'essai ne couvre que l'attente de la réponse ; un flux SSE peut durer plus longtemps.
      endHeaderPhase: () => clearTimeout(attemptTimer),
      done() {
        clearTimeout(attemptTimer);
        clearTimeout(deadlineTimer);
        clientSignal.removeEventListener("abort", onClient);
      },
    };
  }

  async function describeFailure(upstream, provider, model) {
    const text = (await upstream.text().catch(() => "")).slice(0, 4_000);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* corps non JSON */
    }
    const first = Array.isArray(parsed) ? parsed[0] : parsed; // Gemini renvoie parfois un tableau
    const cloudflare = Array.isArray(first?.errors) ? first.errors[0] : undefined; // Cloudflare : { errors: [{ code, message }] }
    const err = first?.error ?? cloudflare ?? first ?? {};
    const message = redact(typeof err.message === "string" ? err.message : typeof err === "string" ? err : text).slice(0, 300);
    const code = String(err.code ?? err.type ?? err.status ?? "");
    const kind = classifyFailure(upstream.status, code, message);
    const failure = { provider: provider.name, model, status: upstream.status, kind, message };
    if (kind === "rate_limit") {
      failure.retryAfter = Math.min(
        COOLDOWN.maxRateLimitS,
        Math.max(1, parseRetryAfter(upstream.headers.get("retry-after"), text, now) ?? COOLDOWN.defaultRateLimitS),
      );
    }
    return failure;
  }

  function applyCooldown(label, failure) {
    const { kind } = failure;
    if (kind === "rate_limit") providers.cooldowns.set(label, failure.retryAfter * 1000, kind);
    else if (kind === "model_unavailable") providers.cooldowns.set(label, COOLDOWN.unavailableMs, kind);
    else if (kind === "auth") providers.cooldowns.set(label, COOLDOWN.authMs, kind);
    else if (kind === "server" || kind === "timeout" || kind === "network") providers.cooldowns.set(label, COOLDOWN.serverMs, kind);
  }

  async function pipeStream({ res, upstream, attempt, meta, ctx }) {
    attempt.endHeaderPhase();
    res.writeHead(200, { ...SSE_HEADERS, ...meta });
    res.flushHeaders?.();
    try {
      for await (const chunk of upstream.body) {
        if (res.destroyed) break; // le client est parti : la boucle se ferme et annule l'appel au fournisseur
        if (!res.write(chunk)) await waitForDrain(res);
      }
      if (!res.destroyed) res.end();
    } catch (e) {
      // Le flux a commencé : impossible de basculer. On prévient le client proprement (format SSE).
      if (attempt.reason !== "client") {
        log.warn(`[${ctx.id}] flux interrompu (${attempt.reason ?? e.message})`);
        if (!res.destroyed && !res.writableEnded) {
          const code = attempt.reason === "deadline" ? "deadline_exceeded" : "upstream_error";
          const message = attempt.reason === "deadline" ? "Délai maximal de la requête dépassé pendant le streaming." : "Le flux du fournisseur a été interrompu.";
          res.write(`data: ${JSON.stringify({ error: { message, type: "api_error", code, request_id: ctx.id } })}\n\n`);
          res.end();
        }
      }
    } finally {
      attempt.done();
    }
  }

  /** Une tentative sur un modèle. Retourne { done: true } si la réponse a été envoyée, sinon { failure }. */
  async function tryTarget({ res, ctx, body, target, label, deadlineAt, clientSignal }) {
    const { provider, model } = target;
    const attempt = newAttempt(deadlineAt, clientSignal);
    try {
      const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ ...body, model }),
        signal: attempt.signal,
      });

      if (upstream.ok) {
        const meta = { "X-Provider": provider.name, "X-Model": model };
        ctx.provider = provider.name;
        ctx.model = model;
        if (body.stream === true) {
          await pipeStream({ res, upstream, attempt, meta, ctx });
          return { done: true };
        }
        const data = await upstream.json(); // toujours sous le délai de la tentative
        attempt.done();
        sendJson(res, 200, data, meta);
        return { done: true };
      }

      const failure = await describeFailure(upstream, provider, model);
      attempt.done();
      applyCooldown(label, failure);
      log.warn(`[${ctx.id}] ✗ ${label} → HTTP ${failure.status} (${failure.kind})`);
      return { failure };
    } catch (e) {
      const why = attempt.reason;
      attempt.done();
      if (why === "client") return { done: true }; // le client a raccroché
      const kind = why === "deadline" ? "deadline" : why === "timeout" ? "timeout" : e instanceof SyntaxError ? "server" : "network";
      const message = kind === "server" ? "Réponse invalide du fournisseur." : kind === "network" ? redact(e.cause?.code ?? e.message) : undefined;
      const failure = { provider: provider.name, model, kind, ...(message ? { message } : {}) };
      if (kind !== "deadline") applyCooldown(label, failure);
      log.warn(`[${ctx.id}] ✗ ${label} → ${kind}${message ? ` (${message})` : ""}`);
      return { failure };
    }
  }

  /** Aucun modèle n'a répondu : choisit le statut HTTP le plus juste. */
  function buildFailure(attempts, { forced, deadlineHit }) {
    const details = attempts.map(({ provider, model, status, kind, message }) => ({ provider, model, ...(status ? { status } : {}), kind, ...(message ? { message } : {}) }));
    const kinds = new Set(attempts.map((a) => a.kind));
    const retryAfter = Math.min(...attempts.map((a) => a.retryAfter ?? COOLDOWN.defaultRateLimitS));

    if (deadlineHit || kinds.has("deadline")) {
      return new GatewayError("deadline_exceeded", undefined, { details });
    }
    if (attempts.length && [...kinds].every((k) => k === "cooling" || k === "rate_limit")) {
      const allPaused = kinds.size === 1 && kinds.has("cooling");
      const message = allPaused
        ? "Tous les modèles sont momentanément en pause (limites atteintes) : réessayez dans un instant."
        : undefined;
      return new GatewayError("rate_limited", message, { headers: { "Retry-After": String(retryAfter) }, details });
    }
    // Les modèles « en pause » ne comptent pas : seule la réponse réelle d'un fournisseur dit si la requête est mauvaise.
    const real = attempts.filter((a) => a.kind !== "cooling");
    if (real.length && real.every((a) => a.kind === "client")) {
      const first = real[0];
      return new GatewayError("upstream_rejected", `${first.provider} a refusé la requête : ${first.message || `HTTP ${first.status}`}`, { status: first.status, details });
    }
    if (forced && attempts.length === 1) {
      const [a] = attempts;
      if (a.kind === "model_unavailable") {
        return new GatewayError("model_not_found", `Le modèle « ${a.model} » n'existe pas (ou plus) chez ${a.provider}.`, { details });
      }
      if (a.kind === "auth") return new GatewayError("upstream_auth_error", undefined, { details });
      if (a.kind === "timeout") return new GatewayError("upstream_timeout", undefined, { details });
    }
    if (kinds.has("auth") && [...kinds].every((k) => k === "auth" || k === "cooling")) {
      return new GatewayError("upstream_auth_error", undefined, { details });
    }
    return new GatewayError("upstream_error", undefined, { details });
  }

  /**
   * Exécute la requête de chat sur la chaîne de modèles.
   * Lève une GatewayError si rien n'a pu être envoyé au client.
   */
  async function run({ res, ctx, body, chain, forced }) {
    if (!chain.length) throw new GatewayError("no_provider_configured");

    const deadlineAt = now() + config.deadlineMs;
    const client = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) client.abort();
    };
    res.once("close", onClose);

    const attempts = [];
    let deadlineHit = false;
    try {
      for (const target of chain) {
        const label = `${target.provider.name}/${target.model}`;

        // Un modèle en pause est ignoré… sauf s'il n'y a pas d'alternative ou si le client l'a demandé explicitement.
        if (!forced && chain.length > 1) {
          const wait = providers.cooldowns.remaining(label);
          if (wait > 0) {
            attempts.push({ provider: target.provider.name, model: target.model, kind: "cooling", retryAfter: Math.ceil(wait / 1000) });
            continue;
          }
        }
        if (deadlineAt - now() < MIN_ATTEMPT_MS) {
          deadlineHit = true;
          break;
        }

        ctx.attempts = (ctx.attempts ?? 0) + 1;
        const outcome = await tryTarget({ res, ctx, body, target, label, deadlineAt, clientSignal: client.signal });
        if (outcome.done) return;
        attempts.push(outcome.failure);
      }
      if (client.signal.aborted) return;
      throw buildFailure(attempts, { forced, deadlineHit });
    } finally {
      res.off("close", onClose);
    }
  }

  return { run };
}
