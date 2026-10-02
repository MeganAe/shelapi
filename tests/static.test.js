import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createStaticServer } from "../src/static.js";
import { rawRequest } from "./_helpers.js";

let dir, server, url;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "static-"));
  await mkdir(join(dir, "public", "docs"), { recursive: true });
  await writeFile(join(dir, "SECRET.txt"), "secret hors du dossier public");
  await writeFile(join(dir, "public", "docs", "index.html"), "<h1>Docs</h1>");
  await writeFile(join(dir, "public", "docs", "style.css"), "body{}");
  await writeFile(join(dir, "public", "robots.txt"), "User-agent: *");

  const serve = createStaticServer(join(dir, "public"));
  server = http.createServer(async (req, res) => {
    if (await serve(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("api");
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const get = (path, method = "GET") => rawRequest(url, { method, path, chunks: [] });

test("sert index.html pour un dossier terminé par « / », avec le bon type MIME", async () => {
  const r = await get("/docs/");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /^text\/html/);
  assert.equal(r.text, "<h1>Docs</h1>");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.match((await get("/docs/style.css")).headers["content-type"], /^text\/css/);
});

test("un dossier sans « / » final est laissé au routeur (qui redirige vers /docs/)", async () => {
  assert.equal((await get("/docs")).text, "api");
});

test("HEAD : en-têtes sans corps ; POST ignoré", async () => {
  const head = await get("/robots.txt", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.text, "");
  assert.equal(head.headers["content-length"], "13");
  assert.equal((await get("/robots.txt", "POST")).text, "api");
});

test("traversée de dossiers impossible : ../, %2e%2e, %2f, antislash, octet nul", async () => {
  for (const path of ["/../SECRET.txt", "/%2e%2e/SECRET.txt", "/docs/..%2f..%2fSECRET.txt", "/docs/../../SECRET.txt", "/..%5cSECRET.txt", "/%00", "/docs/%00.html", "/%E0%A4%A"]) {
    const r = await get(path);
    assert.ok(!r.text.includes("secret hors du dossier"), `${path} a fuité !`);
    assert.equal(r.text, "api", path);
  }
});

test("fichier inexistant : laissé au routeur", async () => {
  assert.equal((await get("/nexiste-pas.html")).text, "api");
});
