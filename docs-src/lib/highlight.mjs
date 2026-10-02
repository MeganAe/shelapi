// Coloration syntaxique à la génération (aucun JavaScript de coloration n'est envoyé au navigateur).
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import { esc } from "./html.mjs";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);

/** Flux SSE : « data: {...} » par ligne, le JSON est coloré. */
function sse(code) {
  return code
    .split("\n")
    .map((line) => {
      const m = /^(data|event|id|retry):\s?(.*)$/.exec(line);
      if (!m) return esc(line);
      const [, field, value] = m;
      const body = value.startsWith("{") ? hljs.highlight(value, { language: "json", ignoreIllegals: true }).value : `<span class="hljs-literal">${esc(value)}</span>`;
      return `<span class="hljs-keyword">${field}:</span> ${body}`;
    })
    .join("\n");
}

/** Retourne le HTML coloré d'un extrait de code. `lang` : bash | javascript | python | json | ini | sse | text. */
export function highlight(code, lang = "text") {
  const source = String(code).replace(/\n+$/, "");
  if (lang === "sse") return sse(source);
  if (lang === "text") return esc(source);
  return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
}
