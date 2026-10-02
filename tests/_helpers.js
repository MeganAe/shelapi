// Outils de test : faux fournisseurs OpenAI-compatibles + passerelle réelle sur un port libre.
import { once } from "node:events";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createHandler } from "../src/handler.js";

export const KEY = "test-key-0123456789abcdef";
export { sleep };

export function memoryLogger() {
  const lines = [];
  const add = (level) => (message) => lines.push(`${level} ${message}`);
  return { lines, info: add("info"), warn: add("warn"), error: add("error") };
}

/** Horloge contrôlable pour tester l'expiration des pauses. */
export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const readAll = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};

const completion = (model, content = "ok") => ({
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 1,
  model,
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const GROQ_MODELS = [
  { id: "model-b", active: true },
  { id: "model-a", active: true },
  { id: "whisper-large-v3", active: true },
  { id: "playai-tts", active: true },
  { id: "llama-guard-4", active: true },
  { id: "retired-model", active: false },
];

/**
 * Faux fournisseurs. URL de base par fournisseur : /groq, /gemini, /cf
 * `rules[provider][chat|models]` = spécification | fonction(call) | tableau (une entrée par appel).
 * Spécification : { status, headers, json, text, delayMs, stall } ou { stream: [...], end: "close"|"destroy"|"hang" }
 */
export async function startUpstream() {
  const calls = [];
  let rules = {};
  const server = http.createServer(async (req, res) => {
    const text = await readAll(req);
    const { pathname } = new URL(req.url, "http://x");
    const [, provider, ...tail] = pathname.split("/");
    const kind = tail.join("/") === "models" ? "models" : "chat";
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* corps vide */
    }
    const call = { provider, kind, body, authorization: req.headers.authorization, aborted: false, n: calls.filter((c) => c.provider === provider && c.kind === kind).length };
    calls.push(call);
    res.on("close", () => {
      call.aborted = !res.writableFinished;
    });

    const rule = rules[provider]?.[kind];
    let spec = typeof rule === "function" ? await rule(call) : Array.isArray(rule) ? rule[Math.min(call.n, rule.length - 1)] : rule;
    if (!spec) {
      spec = kind === "models" ? { json: { object: "list", data: GROQ_MODELS } } : { json: completion(body.model, `echo:${body.messages?.at(-1)?.content}`) };
    }
    await respond(res, spec);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    completion,
    on(provider, kind, rule) {
      rules = { ...rules, [provider]: { ...rules[provider], [kind]: rule } };
    },
    chatCalls: (provider) => calls.filter((c) => c.provider === provider && c.kind === "chat"),
    models: (provider) => calls.filter((c) => c.provider === provider && c.kind === "models"),
    reset() {
      calls.length = 0;
      rules = {};
    },
    async close() {
      server.closeAllConnections?.();
      server.close();
    },
  };
}

async function respond(res, spec) {
  if (spec.delayMs) await sleep(spec.delayMs);
  if (res.destroyed) return;
  if (spec.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", ...spec.headers });
    for (const part of spec.stream) {
      if (res.destroyed) return;
      if (typeof part === "object") await sleep(part.wait);
      else await new Promise((done) => res.write(part, done)); // attend que le morceau parte vraiment
    }
    if (spec.end === "destroy") {
      await sleep(30);
      return res.destroy(); // coupure brutale de la connexion
    }
    if (spec.end === "hang") return;
    return res.end();
  }
  if (spec.stall) {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"id":"chatcmpl-te'); // le corps ne se termine jamais
    return;
  }
  const payload = spec.text ?? JSON.stringify(spec.json ?? {});
  res.writeHead(spec.status ?? 200, { "content-type": spec.text !== undefined ? "text/plain" : "application/json", ...spec.headers });
  res.end(payload);
}

export const chunk = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
export const delta = (content) => chunk({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content }, finish_reason: null }] });

/** Passerelle réelle (createHandler) branchée sur les faux fournisseurs. */
export async function startGateway({ upstream, env = {}, now } = {}) {
  const log = memoryLogger();
  const base = {
    GATEWAY_KEYS: KEY,
    GROQ_API_KEY: "groq-secret",
    GROQ_BASE_URL: `${upstream.url}/groq`,
    GROQ_MODEL: "model-a",
    GEMINI_API_KEY: "gemini-secret",
    GEMINI_BASE_URL: `${upstream.url}/gemini`,
    GEMINI_MODEL: "gem-1,gem-2",
    CLOUDFLARE_API_TOKEN: "cf-secret",
    CLOUDFLARE_ACCOUNT_ID: "acc",
    CLOUDFLARE_BASE_URL: `${upstream.url}/cf`,
    CLOUDFLARE_MODEL: "@cf/cf-1",
    TIMEOUT_MS: "1500",
    DEADLINE_MS: "8000",
  };
  const merged = Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, v]) => v !== undefined));
  const handler = createHandler({ env: merged, log, ...(now ? { now } : {}) });
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;

  /** Appel simple : retourne { status, headers, text, json }. */
  async function api(path, { method = "GET", key = KEY, body, headers = {}, rawBody } = {}) {
    const h = { ...headers };
    if (key) h.Authorization = `Bearer ${key}`;
    if (body !== undefined || rawBody !== undefined) h["Content-Type"] = h["Content-Type"] ?? "application/json";
    const res = await fetch(url + path, { method, headers: h, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      /* pas du JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  const chat = (body, opts = {}) => api("/v1/chat/completions", { method: "POST", body, ...opts });
  const hi = { messages: [{ role: "user", content: "Bonjour" }] };

  return {
    url,
    handler,
    log,
    api,
    chat,
    hi,
    async close() {
      server.closeAllConnections?.();
      server.close();
    },
  };
}

/** Requête HTTP brute avec corps envoyé en plusieurs morceaux (pour tester les accents coupés, le chunked…). */
export function rawRequest(url, { method = "POST", path, headers = {}, chunks = [], gapMs = 30 }) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    (async () => {
      for (const c of chunks) {
        req.write(c);
        await sleep(gapMs);
      }
      req.end();
    })();
  });
}

/** Raccourci : réinitialise le faux fournisseur, démarre une passerelle neuve, la ferme à la fin. */
export async function withGateway(upstream, opts, fn) {
  if (typeof opts === "function") [fn, opts] = [opts, {}];
  upstream.reset();
  const gw = await startGateway({ upstream, ...opts });
  try {
    await fn(gw);
  } finally {
    await gw.close();
  }
}
