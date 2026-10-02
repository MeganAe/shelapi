// Le script d'aperçu (npm run preview) et le serveur local (local.js) fonctionnent vraiment, de bout en bout :
// documentation servie, réponse simulée, bascule vers un autre fournisseur.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { after, before, test } from "node:test";

const KEY = "cle-de-test-apercu-0123456789";
let child;
let base;
let output = "";

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["scripts/preview.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), GATEWAY_KEYS: KEY, LOG_LEVEL: "silent" },
  });
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const deadline = Date.now() + 10_000;
  while (!output.includes("Documentation")) {
    if (child.exitCode !== null) throw new Error(`le script d'aperçu s'est arrêté : ${output}`);
    if (Date.now() > deadline) throw new Error(`le script d'aperçu n'a pas démarré : ${output}`);
    await new Promise((r) => setTimeout(r, 50));
  }
});

after(() => child?.kill());

const chat = (content, extra = {}) =>
  fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content }], ...extra }),
  });

test("l'aperçu annonce clairement que les fournisseurs sont simulés", () => {
  assert.match(output, /MODE APERÇU/);
  assert.match(output, /SIMULÉS/);
});

test("la documentation est servie sur /docs/ (HTML, nosniff) et /docs redirige", async () => {
  const page = await fetch(`${base}/docs/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html; charset=utf-8/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(await page.text(), /<title>Shel API — Documentation<\/title>/);
  const redirect = await fetch(`${base}/docs`, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), "/docs/");
});

test("une requête obtient une réponse SIMULÉE, étiquetée comme telle", async () => {
  const response = await chat("Bonjour");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-provider"), "groq");
  const data = await response.json();
  assert.match(data.choices[0].message.content, /^\[SIMULÉ · groq\]/);
});

test("le streaming fonctionne et se termine par [DONE]", async () => {
  const response = await chat("Bonjour", { stream: true });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  const text = await response.text();
  assert.ok(text.includes("[SIMULÉ"));
  assert.ok(text.trimEnd().endsWith("data: [DONE]"));
});

test("la bascule est démontrable : [429] fait répondre Gemini, [panne] fait répondre Cloudflare", async () => {
  assert.equal((await chat("essai [429]")).headers.get("x-provider"), "gemini");
  assert.equal((await chat("essai [panne]")).headers.get("x-provider"), "cloudflare");
});

test("la liste des modèles et la spécification OpenAPI sont disponibles", async () => {
  const models = await (await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  assert.equal(models.data[0].id, "auto");
  assert.ok(models.data.some((m) => m.id === "groq/openai/gpt-oss-120b"));
  const spec = await (await fetch(`${base}/openapi.json`)).json();
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.servers[0].url, base);
});
