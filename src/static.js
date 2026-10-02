// =====================================================================
//  Serveur de fichiers statiques minimal — utilisé uniquement par local.js.
//  Sur Vercel, le dossier public/ est servi directement par le CDN.
// =====================================================================
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Retourne une fonction (req, res) => Promise<boolean> : `true` si la requête a été servie.
 * Protège contre la remontée de dossiers (../) et ne sert un dossier que si l'URL finit par « / »
 * (comme Vercel : /docs → le routeur redirige vers /docs/).
 */
export function createStaticServer(root) {
  const base = normalize(root);
  return async function serve(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    try {
      const pathname = decodeURIComponent(String(req.url ?? "/").split(/[?#]/)[0]);
      if (pathname.includes("\0") || !pathname.startsWith("/")) return false;

      let file = normalize(join(base, pathname));
      if (file !== base && !file.startsWith(base + sep)) return false;

      let info = await stat(file);
      if (info.isDirectory()) {
        if (!pathname.endsWith("/")) return false;
        file = join(file, "index.html");
        info = await stat(file);
      }
      if (!info.isFile()) return false;

      res.writeHead(200, {
        "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (req.method === "HEAD") res.end();
      else await pipeline(createReadStream(file), res);
      return true;
    } catch (e) {
      if (res.headersSent) return true; // erreur pendant l'envoi : rien de plus à faire
      return false; // fichier absent, URL mal encodée… → on laisse la main au routeur
    }
  };
}
