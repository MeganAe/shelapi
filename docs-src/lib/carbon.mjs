// Balisage des composants Carbon (classes CSS officielles `cds--*`, structure relevée sur @carbon/react).
// Le comportement (onglets, accordéon, copie…) est assuré par client/app.js, sans framework.
import { esc, join, prose } from "./html.mjs";
import { highlight } from "./highlight.mjs";
import { icon } from "./icons.mjs";

let counter = 0;
export const uid = (prefix = "id") => `${prefix}-${++counter}`;

// ---------------------------------------------------------------- Tag
export function tag(text, type = "gray", { size = "", title = "" } = {}) {
  const cls = join("cds--tag", size && ` cds--tag--${size}`, ` cds--tag--${type}`);
  return `<span class="${cls}"><span class="cds--tag__label"${title ? ` title="${esc(title)}"` : ""}>${esc(text)}</span></span>`;
}

export const methodTag = (method) => tag(method.toUpperCase(), method.toUpperCase() === "GET" ? "blue" : "green", { size: "md" });

export function statusTag(status) {
  const code = String(status);
  const type = code.startsWith("2") ? "green" : code.startsWith("3") ? "cool-gray" : code.startsWith("4") ? "red" : "magenta";
  return tag(code, type);
}

// ---------------------------------------------------------------- Notification
const NOTIFICATION_ICONS = { info: "information--filled", success: "checkmark--filled", warning: "warning--alt--filled", error: "error--filled" };

/** `body` est du HTML déjà prêt (voir markdown.mjs). */
export function notification(kind, title, body) {
  return (
    `<div class="cds--inline-notification cds--inline-notification--low-contrast cds--inline-notification--${kind} cds--inline-notification--hide-close-button" role="note">` +
    `<div class="cds--inline-notification__details">${icon(NOTIFICATION_ICONS[kind], 20, "cds--inline-notification__icon")}` +
    `<div class="cds--inline-notification__text-wrapper"><p class="cds--inline-notification__title">${esc(title)}</p>` +
    `<div class="cds--inline-notification__subtitle">${body}</div></div></div></div>`
  );
}

// ---------------------------------------------------------------- Bouton de copie + info-bulle
export function copyButton(label = "Copier") {
  const id = uid("tip");
  return (
    `<span class="cds--popover-container cds--popover--caret cds--popover--high-contrast cds--popover--bottom-end cds--tooltip cds--icon-tooltip" data-tooltip>` +
    `<div class="cds--tooltip-trigger__wrapper"><button type="button" class="cds--copy-btn cds--copy cds--btn cds--btn--sm cds--layout--size-sm cds--btn--primary cds--btn--icon-only" data-copy aria-labelledby="${id}">` +
    `${icon("copy", 16, "cds--snippet__icon")}${icon("checkmark", 16, "cds--snippet__icon docs-icon-done")}</button></div>` +
    `<span aria-hidden="true" id="${id}" role="tooltip" class="cds--popover"><span class="cds--popover-content cds--tooltip-content" data-tooltip-text data-label="${esc(label)}">${esc(label)}</span><span class="cds--popover-caret"></span></span></span>`
  );
}

// ---------------------------------------------------------------- Bloc de code
/** `lang` : bash | javascript | python | json | ini | sse | text. `label` : nom lu par les lecteurs d'écran. */
export function snippet(code, lang = "text", { label = "", base = false } = {}) {
  let body = highlight(code, lang);
  // L'URL de base est remplacée dans le navigateur par l'adresse réelle de la passerelle.
  if (base) body = body.replaceAll(BASE_URL, `<span data-base>${BASE_URL}</span>`); // BASE_URL ne contient aucun caractère à échapper
  return (
    `<div class="cds--snippet cds--snippet--multi docs-snippet">` +
    `<div class="cds--snippet-container" role="group" tabindex="0" aria-label="${esc(label || `Exemple ${lang}`)}">` +
    `<pre><code class="hljs language-${lang}">${body}</code></pre></div>` +
    `<div class="docs-snippet__copy">${copyButton("Copier")}</div></div>`
  );
}

/** Code court en ligne, avec copie au clic (Carbon « inline snippet »). */
export function inlineSnippet(text, { base = false } = {}) {
  const id = uid("inl");
  const content = base ? `<span data-base>${esc(text)}</span>` : esc(text);
  return `<button type="button" class="cds--snippet cds--snippet--inline cds--copy cds--btn cds--btn--primary cds--btn--icon-only" data-copy-inline title="Copier" aria-describedby="${id}"><code id="${id}">${content}</code></button>`;
}

// ---------------------------------------------------------------- Onglets
/** items : [{ key, label, html }]. `group` : les onglets de même groupe restent synchronisés (ex. langage). */
export function tabs(items, { label, group = "" } = {}) {
  const base = uid("tabs");
  const list = items
    .map(
      (it, i) =>
        `<button class="cds--tabs__nav-item cds--tabs__nav-link${i === 0 ? " cds--tabs__nav-item--selected" : ""}" role="tab" type="button" id="${base}-tab-${i}" aria-controls="${base}-panel-${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"${it.key ? ` data-key="${esc(it.key)}"` : ""}>` +
        `<div class="cds--tabs__nav-item-label-wrapper"><span class="cds--tabs__nav-item-label">${esc(it.label)}</span></div></button>`,
    )
    .join("");
  const panels = items
    .map((it, i) => `<div class="cds--tab-content" role="tabpanel" id="${base}-panel-${i}" aria-labelledby="${base}-tab-${i}"${i === 0 ? "" : " hidden"}>${it.html}</div>`)
    .join("");
  return `<div class="docs-tabs" data-tabs${group ? ` data-group="${esc(group)}"` : ""}><div class="cds--tabs"><div class="cds--tab--list" role="tablist" aria-label="${esc(label)}">${list}</div></div>${panels}</div>`;
}

// ---------------------------------------------------------------- Accordéon
/** items : [{ title, html, open }] */
export function accordion(items) {
  const lis = items
    .map((it) => {
      const id = uid("acc");
      return (
        `<li class="cds--accordion__item${it.open ? " cds--accordion__item--active" : ""}">` +
        `<button type="button" class="cds--accordion__heading" aria-controls="${id}" aria-expanded="${Boolean(it.open)}">` +
        `${icon("chevron--right", 16, "cds--accordion__arrow")}<div class="cds--accordion__title">${it.title}</div></button>` +
        `<div class="cds--accordion__wrapper"><div id="${id}" class="cds--accordion__content">${it.html}</div></div></li>`
      );
    })
    .join("");
  return `<ul class="cds--accordion cds--accordion--start docs-accordion" data-accordion>${lis}</ul>`;
}

// ---------------------------------------------------------------- Tableau
/** head : [texte] ; rows : [[html, html…]] (cellules en HTML déjà prêt). */
export function table({ head, rows, label, className = "" }) {
  // Sur téléphone, le tableau devient une pile de fiches (voir styles/main.scss) : chaque cellule porte son intitulé
  // (data-label) et les rôles ARIA gardent la sémantique de tableau malgré le changement d'affichage CSS.
  const thead = `<thead role="rowgroup"><tr role="row">${head.map((h) => `<th scope="col" role="columnheader"><div class="cds--table-header-label">${esc(h)}</div></th>`).join("")}</tr></thead>`;
  const tbody = `<tbody role="rowgroup">${rows.map((r) => `<tr role="row">${r.map((c, i) => `<td role="cell" data-label="${esc(head[i])}">${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<div class="docs-table-scroll" role="region" tabindex="0" aria-label="${esc(label)}"><div class="cds--data-table-content"><table role="table" class="cds--data-table cds--data-table--lg docs-table ${className}">${thead}${tbody}</table></div></div>`;
}

// ---------------------------------------------------------------- Boutons
export function button(label, { href, kind = "primary", iconName, size = "", attrs = "" } = {}) {
  const cls = `cds--btn cds--btn--${kind}${size ? ` cds--btn--${size}` : ""}`;
  const content = `${prose(label)}${iconName ? icon(iconName, 16, "cds--btn__icon") : ""}`;
  return href ? `<a class="${cls}" href="${esc(href)}"${attrs ? ` ${attrs}` : ""}>${content}</a>` : `<button type="button" class="${cls}"${attrs ? ` ${attrs}` : ""}>${content}</button>`;
}

// ---------------------------------------------------------------- Formulaires
export function textInput({ id, label, help = "", type = "text", placeholder = "", value = "", attrs = "" }) {
  return (
    `<div class="cds--form-item cds--text-input-wrapper"><div class="cds--text-input__label-wrapper"><label for="${id}" class="cds--label">${esc(label)}</label></div>` +
    `<div class="cds--text-input__field-outer-wrapper"><div class="cds--text-input__field-wrapper"><input id="${id}" type="${type}" class="cds--text-input" placeholder="${esc(placeholder)}" value="${esc(value)}"${help ? ` aria-describedby="${id}-help"` : ""} ${attrs}/></div>` +
    `${help ? `<div id="${id}-help" class="cds--form__helper-text">${help}</div>` : ""}</div></div>`
  );
}

export function textArea({ id, label, help = "", rows = 4, value = "", attrs = "" }) {
  return (
    `<div class="cds--form-item"><div class="cds--text-area__label-wrapper"><label for="${id}" class="cds--label">${esc(label)}</label></div>` +
    `<div class="cds--text-area__wrapper"><textarea id="${id}" class="cds--text-area" rows="${rows}"${help ? ` aria-describedby="${id}-help"` : ""} ${attrs}>${esc(value)}</textarea></div>` +
    `${help ? `<div id="${id}-help" class="cds--form__helper-text">${help}</div>` : ""}</div>`
  );
}

export function select({ id, label, options, help = "", attrs = "" }) {
  return (
    `<div class="cds--form-item"><div class="cds--select"><label for="${id}" class="cds--label">${esc(label)}</label>` +
    `<div class="cds--select-input__wrapper"><select id="${id}" class="cds--select-input"${help ? ` aria-describedby="${id}-help"` : ""} ${attrs}>${options.map(([value, text]) => `<option class="cds--select-option" value="${esc(value)}">${esc(text)}</option>`).join("")}</select>` +
    `${icon("chevron--down", 16, "cds--select__arrow")}</div></div>${help ? `<div id="${id}-help" class="cds--form__helper-text">${help}</div>` : ""}</div>`
  );
}

export function toggle({ id, label, off = "Non", on = "Oui", checked = false }) {
  return (
    `<div class="cds--toggle"><button id="${id}" class="cds--toggle__button" role="switch" type="button" aria-checked="${checked}" aria-labelledby="${id}-label" data-toggle data-on="${esc(on)}" data-off="${esc(off)}"></button>` +
    `<label id="${id}-label" for="${id}" class="cds--toggle__label"><span class="cds--toggle__label-text">${esc(label)}</span>` +
    `<div class="cds--toggle__appearance cds--toggle__appearance--sm"><div class="cds--toggle__switch"><svg aria-hidden="true" focusable="false" class="cds--toggle__check" width="6px" height="5px" viewBox="0 0 6 5"><path d="M2.2 2.7L5 0 6 1 2.2 5 0 2.7 1 1.5z"></path></svg></div>` +
    `<span class="cds--toggle__text" aria-hidden="true">${esc(checked ? on : off)}</span></div></label></div>`
  );
}

// ---------------------------------------------------------------- URL de base (remplacée dans le navigateur)
export const BASE_URL = "https://votre-projet.vercel.app";
