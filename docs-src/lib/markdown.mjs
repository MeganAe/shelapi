// Mini-Markdown (suffisant pour les descriptions OpenAPI et les textes de la page).
// Gère : paragraphes, listes à puces / numérotées, `code`, **gras**, [liens](url).
// Tout le texte est échappé AVANT la mise en forme : aucune balise HTML brute ne peut passer.
import { esc, typo } from "./html.mjs";

const SAFE_URL = /^(https?:\/\/|\/|#|mailto:)/i;

export function inline(text) {
  const codes = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const raw = url.replace(/&amp;/g, "&");
      if (!SAFE_URL.test(raw)) return label;
      const external = /^https?:/i.test(raw);
      return `<a class="cds--link" href="${esc(raw)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
    });
  // La typographie s'applique au texte, pas au contenu des blocs de code (restaurés après).
  return typo(out).replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

export function markdown(source) {
  const lines = String(source ?? "").trim().split("\n");
  const html = [];
  let paragraph = [];
  let list = null; // { tag, items }

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
    } else if (list && /^\s+\S/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`; // ligne de continuation d'un item
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return html.join("");
}
