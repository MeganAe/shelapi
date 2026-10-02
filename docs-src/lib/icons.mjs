// Icônes Carbon (SVG vendorisés dans docs-src/icons/) intégrées directement dans le HTML.
import { readFileSync } from "node:fs";

const cache = new Map();

export function icon(name, size = 16, className = "") {
  if (!cache.has(name)) {
    const file = new URL(`../icons/${name}.svg`, import.meta.url);
    cache.set(name, readFileSync(file, "utf8").trim().replace(' xmlns="http://www.w3.org/2000/svg"', ""));
  }
  const attrs = `${className ? `class="${className}" ` : ""}width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false"`;
  return cache.get(name).replace("<svg ", `<svg ${attrs} `);
}
