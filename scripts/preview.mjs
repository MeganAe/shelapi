// =====================================================================
//  Aperçu local SANS clés : la vraie passerelle et la vraie documentation, branchées sur de FAUX
//  fournisseurs. Toutes les réponses sont SIMULÉES (préfixe « [SIMULÉ] ») : rien n'est envoyé sur Internet.
//
//      npm run preview        puis ouvrir http://localhost:3000/docs/
//
//  Pour essayer la bascule dans le terrain de jeu, ajoutez à votre message :
//      [429]    Groq répond « limite atteinte » → Gemini prend le relais
//      [panne]  Groq et Gemini tombent en panne → Cloudflare prend le relais
//      [lent]   la réponse met 3 secondes (pour essayer le bouton « Arrêter »)
// =====================================================================
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const DEMO_KEY = process.env.GATEWAY_KEYS?.split(",")[0]?.trim() || "demo-key-0123456789abcdef";
const MODELS = { groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b"] };

const lastUserMessage = (body) => {
  const found = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  return typeof found?.content === "string" ? found.content : "";
};

const sendJson = (res, status, data, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
};

const mock = http.createServer(async (req, res) => {
  const [, provider, ...rest] = new URL(req.url, "http://mock").pathname.split("/");
  const route = rest.join("/");

  if (req.method === "GET" && provider === "groq" && route === "models") {
    return sendJson(res, 200, { object: "list", data: MODELS.groq.map((id) => ({ id, object: "model", active: true })) });
  }
  if (req.method !== "POST" || route !== "chat/completions") return sendJson(res, 404, { error: { message: "Route inconnue (aperçu)" } });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const prompt = lastUserMessage(body);

  if (/\[lent\]/i.test(prompt)) await sleep(3000);
  if (provider === "groq" && /\[429\]/.test(prompt)) {
    return sendJson(res, 429, { error: { message: "Rate limit reached (réponse simulée)", type: "rate_limit_exceeded" } }, { "Retry-After": "15" });
  }
  if (provider !== "cf" && /\[panne\]/i.test(prompt)) {
    return sendJson(res, 503, { error: { message: "Service unavailable (réponse simulée)" } });
  }

  const answer = `[SIMULÉ · ${provider}] Ceci est une réponse de démonstration du modèle ${body.model}. Votre message : « ${prompt.slice(0, 160)} »`;
  const base = { id: `chatcmpl-demo-${Date.now().toString(36)}`, created: Math.floor(Date.now() / 1000), model: body.model };

  if (body.stream === true) {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    send({ role: "assistant", content: "" });
    for (const word of answer.split(/(?<= )/)) {
      if (res.destroyed) return;
      send({ content: word });
      await sleep(45);
    }
    send({}, "stop");
    return res.end("data: [DONE]\n\n");
  }
  return sendJson(res, 200, {
    ...base,
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 31, total_tokens: 43 },
  });
});

await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;

// Variables lues par la passerelle au démarrage (api/index.js) : on les fixe AVANT de l'importer.
Object.assign(process.env, {
  GATEWAY_KEYS: DEMO_KEY,
  GROQ_API_KEY: "apercu",
  GEMINI_API_KEY: "apercu",
  CLOUDFLARE_API_TOKEN: "apercu",
  CLOUDFLARE_ACCOUNT_ID: "apercu",
  GROQ_BASE_URL: `${mockUrl}/groq`,
  GEMINI_BASE_URL: `${mockUrl}/gemini`,
  CLOUDFLARE_BASE_URL: `${mockUrl}/cf`,
});

console.log("┌─────────────────────────────────────────────────────────────────────┐");
console.log("│  MODE APERÇU — fournisseurs SIMULÉS, aucune requête vers Internet   │");
console.log(`│  Clé de démonstration : ${DEMO_KEY.padEnd(44)}│`);
console.log("└─────────────────────────────────────────────────────────────────────┘");

await import("../local.js");
