// Lancement en local (sans Vercel) : node local.js
import http from "node:http";
import handler from "./api/index.js";

const port = Number(process.env.PORT) || 3000;
http.createServer(handler).listen(port, () => {
  console.log(`Gateway IA sur http://localhost:${port}`);
});
