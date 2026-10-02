// Compile la feuille de style (Carbon + styles de la page) et prépare les polices IBM Plex intégrées en base64.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export function compileStyles() {
  const { css } = sass.compile(here("../styles/main.scss"), {
    loadPaths: [here("../node_modules")],
    style: "compressed",
    quietDeps: true, // les avertissements de dépréciation viennent de Carbon, pas de ce dépôt
    silenceDeprecations: ["import", "global-builtin", "color-functions", "if-function"],
  });
  return css;
}

// Sous-ensembles « Latin1 » (français inclus : accents, œ, guillemets, tirets, points de suspension).
const FONTS = [
  ["IBM Plex Sans", 300, "@ibm/plex-sans", "IBMPlexSans-Light-Latin1.woff2"],
  ["IBM Plex Sans", 400, "@ibm/plex-sans", "IBMPlexSans-Regular-Latin1.woff2"],
  ["IBM Plex Sans", 600, "@ibm/plex-sans", "IBMPlexSans-SemiBold-Latin1.woff2"],
  ["IBM Plex Mono", 400, "@ibm/plex-mono", "IBMPlexMono-Regular-Latin1.woff2"],
  ["IBM Plex Mono", 600, "@ibm/plex-mono", "IBMPlexMono-SemiBold-Latin1.woff2"],
];

export function fontFaces() {
  return FONTS.map(([family, weight, pkg, file]) => {
    const data = readFileSync(here(`../node_modules/${pkg}/fonts/split/woff2/${file}`)).toString("base64");
    return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
  }).join("");
}
