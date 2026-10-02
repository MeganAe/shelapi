// =====================================================================
//  Lancement en local (sans Vercel) : node local.js   (ou npm start)
//  Sert la documentation (public/) puis délègue tout le reste à l'API.
// =====================================================================
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "./api/index.js";
import { createStaticServer } from "./src/static.js";

const port = Number(process.env.PORT) || 3000;
const serveStatic = createStaticServer(resolve(dirname(fileURLToPath(import.meta.url)), "public"));

const server = http.createServer(async (req, res) => {
  try {
    if (await serveStatic(req, res)) return;
    await handler(req, res);
  } catch (e) {
    // Filet de sécurité : le handler gère déjà ses erreurs, mais un serveur local ne doit jamais s'arrêter.
    console.error("[local] erreur inattendue :", e);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Erreur interne", type: "api_error", code: "internal_error" } }));
    } else {
      res.destroy();
    }
  }
});

process.on("unhandledRejection", (reason) => console.error("[local] promesse rejetée non gérée :", reason));

server.listen(port, () => {
  console.log(`AI Gateway sur http://localhost:${port}`);
  console.log(`Documentation   http://localhost:${port}/docs/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} reçu : arrêt…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref(); // ne pas attendre un flux SSE ouvert
  });
}
