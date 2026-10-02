// Transforme la spécification OpenAPI (src/openapi.js) en HTML : endpoints, schémas, réponses, exemples.
import { accordion, methodTag, snippet, statusTag, table, tabs, tag } from "./carbon.mjs";
import { esc, join } from "./html.mjs";
import { icon } from "./icons.mjs";
import { inline, markdown } from "./markdown.mjs";
import { samples } from "./samples.mjs";

const HTTP_REASONS = {
  200: "OK", 302: "Redirection", 400: "Requête invalide", 401: "Non authentifié", 404: "Introuvable", 413: "Corps trop gros",
  429: "Limite atteinte", 502: "Échec des fournisseurs", 503: "Service non configuré", 504: "Délai dépassé",
};

export function createReference(spec) {
  const lookup = (ref) => ref.replace(/^#\//, "").split("/").reduce((node, key) => node?.[key], spec);
  const resolve = (node) => (node?.$ref ? lookup(node.$ref) : node);
  const refName = (ref) => ref.split("/").pop();

  // ------------------------------------------------------------ Types et contraintes
  function typeHtml(schema) {
    if (!schema) return "";
    if (schema.$ref) return `<a class="cds--link" href="#schema-${esc(refName(schema.$ref))}">${esc(refName(schema.$ref))}</a>`;
    const alternatives = schema.oneOf ?? schema.anyOf;
    if (alternatives) return alternatives.map(typeHtml).join(" ou ");
    if (schema.const !== undefined) return esc(JSON.stringify(schema.const));
    const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? "any"];
    return types
      .map((t) => (t === "array" ? `${typeHtml(schema.items) || "any"}[]` : esc(t === "null" ? "null" : t)))
      .join(" | ") + (schema.format ? ` <span class="docs-muted">(${esc(schema.format)})</span>` : "");
  }

  function constraints(schema) {
    const out = [];
    const code = (v) => `<code>${esc(typeof v === "string" ? v : JSON.stringify(v))}</code>`;
    if (schema.enum) {
      out.push(schema.enum.length > 8 ? `${schema.enum.length} valeurs possibles (voir la <a class="cds--link" href="#erreurs">liste des erreurs</a>)` : `Valeurs : ${schema.enum.map(code).join(", ")}`);
    }
    if (schema.default !== undefined) out.push(`Par défaut : ${code(schema.default)}`);
    if (schema.minimum !== undefined && schema.maximum !== undefined) out.push(`Entre ${code(schema.minimum)} et ${code(schema.maximum)}`);
    else if (schema.minimum !== undefined) out.push(`Minimum : ${code(schema.minimum)}`);
    else if (schema.maximum !== undefined) out.push(`Maximum : ${code(schema.maximum)}`);
    if (schema.minItems !== undefined) out.push(`Au moins ${schema.minItems} élément${schema.minItems > 1 ? "s" : ""}`);
    if (schema.maxItems !== undefined) out.push(`Au plus ${schema.maxItems} éléments`);
    if (schema.examples?.length) out.push(`Exemples : ${schema.examples.slice(0, 5).map(code).join(", ")}`);
    return out;
  }

  // ------------------------------------------------------------ Tableau des champs d'un schéma
  function flatten(schema, prefix = "", requiredSet = new Set()) {
    const rows = [];
    for (const [name, raw] of Object.entries(schema.properties ?? {})) {
      const child = raw;
      const path = `${prefix}${name}`;
      rows.push({ path, schema: child, required: requiredSet.has(name) });
      if (!child.$ref) {
        if (child.type === "object" && child.properties) rows.push(...flatten(child, `${path}.`, new Set(child.required ?? [])));
        else if (child.type === "array" && child.items && !child.items.$ref && child.items.type === "object" && child.items.properties) {
          rows.push(...flatten(child.items, `${path}[].`, new Set(child.items.required ?? [])));
        }
      }
    }
    return rows;
  }

  function fieldsTable(schema, label) {
    const rows = flatten(schema, "", new Set(schema.required ?? [])).map(({ path, schema: field, required }) => {
      const extra = constraints(field);
      const description = join(field.description ? `<p>${inline(field.description)}</p>` : "", extra.length ? `<p class="docs-muted">${extra.join(" · ")}</p>` : "");
      return [
        `<code>${esc(path)}</code>${required ? '<span class="docs-required">requis</span>' : ""}`,
        `<span class="docs-type">${typeHtml(field)}</span>`,
        description || '<span class="docs-muted">—</span>',
      ];
    });
    if (!rows.length) return "";
    return table({ head: ["Champ", "Type", "Description"], rows, label, className: "docs-table--wrap" });
  }

  // ------------------------------------------------------------ Paramètres
  function parametersTable(parameters = [], label) {
    if (!parameters.length) return "";
    const rows = parameters.map((p) => [
      `<code>${esc(p.name)}</code>${p.required ? '<span class="docs-required">requis</span>' : ""}`,
      esc({ path: "chemin", query: "requête", header: "en-tête" }[p.in] ?? p.in),
      `<span class="docs-type">${typeHtml(p.schema)}</span>`,
      join(inline(p.description ?? ""), p.example !== undefined ? `<p class="docs-muted">Exemple : <code>${esc(p.example)}</code></p>` : ""),
    ]);
    return table({ head: ["Nom", "Dans", "Type", "Description"], rows, label, className: "docs-table--wrap" });
  }

  // ------------------------------------------------------------ Réponses
  const headersTable = (headers = {}, label) => {
    const rows = Object.entries(headers).map(([name, h]) => [`<code>${esc(name)}</code>`, inline(h.description ?? ""), h.example !== undefined ? `<code>${esc(h.example)}</code>` : ""]);
    return rows.length ? table({ head: ["En-tête", "Description", "Exemple"], rows, label, className: "docs-table--wrap" }) : "";
  };

  function exampleBlocks(content = {}, label) {
    const blocks = [];
    for (const [type, media] of Object.entries(content)) {
      for (const [key, example] of Object.entries(media.examples ?? {})) {
        const value = example.value;
        const isSse = type === "text/event-stream";
        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
        const title = example.summary ?? key;
        blocks.push(`<p class="docs-muted"><strong>${esc(title)}</strong>${isSse ? " (flux SSE)" : ""}</p>${snippet(text, isSse ? "sse" : "json", { label: `${label} : ${title}` })}`);
      }
    }
    return blocks.join("");
  }

  function responsesAccordion(responses, opName) {
    const items = Object.entries(responses).map(([status, raw]) => {
      const response = resolve(raw);
      const description = response.description ?? HTTP_REASONS[status] ?? "";
      const label = `${opName}, réponse ${status}`;
      return {
        open: status === "200",
        title: `${statusTag(status)}<span>${inline(description)}</span>`,
        html: join(
          headersTable(response.headers, `${label} : en-têtes`),
          exampleBlocks(response.content, label) || (response.headers ? "" : '<p class="docs-muted">Pas de corps.</p>'),
        ),
      };
    });
    return accordion(items);
  }

  // ------------------------------------------------------------ Un endpoint
  function operation(path, method, op) {
    const id = `op-${op.operationId}`;
    const publicEndpoint = Array.isArray(op.security) && op.security.length === 0;
    const label = `${method.toUpperCase()} ${path}`;
    const body = op.requestBody?.content?.["application/json"];
    const bodySchema = body ? resolve(body.schema) : null;
    const bodyExamples = Object.entries(body?.examples ?? {});

    const primary = bodyExamples[0]?.[1]?.value;
    const request = samples({
      method,
      path: path.replace("{model}", op.parameters?.find((p) => p.name === "model")?.example ?? "model"),
      body: primary,
      auth: !publicEndpoint,
      sdk: path === "/v1/chat/completions",
    });

    return join(
      `<article class="docs-endpoint" id="${id}" aria-labelledby="${id}-title">`,
      `<div class="docs-endpoint__title">${methodTag(method)}<span class="docs-endpoint__path" id="${id}-title">${esc(path)}</span></div>`,
      `<div class="docs-endpoint__meta">${publicEndpoint ? tag("Public — aucune clé requise", "green", { size: "sm" }) : tag("Clé API requise", "purple", { size: "sm" })}${tag(op.operationId, "outline", { size: "sm", title: "Identifiant d'opération OpenAPI" })}</div>`,
      `<h3>${esc(op.summary)}</h3>`,
      `<div class="docs-prose">${markdown(op.description)}</div>`,
      op.parameters?.length ? `<h4>Paramètres</h4>${parametersTable(op.parameters, `${label} : paramètres`)}` : "",
      bodySchema ? `<h4>Corps de la requête</h4>${fieldsTable(bodySchema, `${label} : corps de la requête`)}` : "",
      bodyExamples.length > 1
        ? accordion([{ title: `Autres exemples de corps (${bodyExamples.length})`, html: bodyExamples.map(([key, ex]) => `<p class="docs-muted"><strong>${esc(ex.summary ?? key)}</strong></p>${snippet(JSON.stringify(ex.value, null, 2), "json", { label: `${label} : ${ex.summary ?? key}` })}`).join("") }])
        : "",
      `<h4>Exemple de requête</h4>`,
      tabs(request.map((s) => ({ key: s.key, label: s.label, html: snippet(s.code, s.lang, { base: true, label: `${label} : exemple ${s.label}` }) })), { label: `Langage de l'exemple ${label}`, group: "lang" }),
      `<h4>Réponses</h4>`,
      responsesAccordion(op.responses, label),
      `</article>`,
    );
  }

  /** Endpoints regroupés par tag, dans l'ordre déclaré dans la spécification. */
  function endpointsByTag() {
    const groups = new Map(spec.tags.map((t) => [t.name, { ...t, operations: [] }]));
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(item)) groups.get(op.tags[0]).operations.push({ path, method, op });
    }
    return [...groups.values()].filter((g) => g.operations.length);
  }

  function referenceHtml() {
    return endpointsByTag()
      .map((group) => join(`<h3 class="docs-tag-title" id="tag-${esc(group.name)}">${esc(group.name)}</h3>`, `<p class="docs-muted">${inline(group.description)}</p>`, group.operations.map(({ path, method, op }) => operation(path, method, op))))
      .join("");
  }

  function schemasHtml() {
    return Object.entries(spec.components.schemas)
      .map(([name, schema]) => join(
        `<h3 id="schema-${esc(name)}">${esc(name)}</h3>`,
        schema.description ? `<div class="docs-prose">${markdown(schema.description)}</div>` : "",
        fieldsTable(schema, `Schéma ${name}`) || '<p class="docs-muted">Objet sans champ documenté.</p>',
      ))
      .join("");
  }

  /** Entrées du menu latéral pour la référence. */
  function navEntries() {
    return endpointsByTag().flatMap((g) => g.operations.map(({ path, method, op }) => ({ id: `op-${op.operationId}`, method: method.toUpperCase(), path })));
  }

  return { referenceHtml, schemasHtml, navEntries, operationIds: () => endpointsByTag().flatMap((g) => g.operations.map((o) => o.op.operationId)) };
}
