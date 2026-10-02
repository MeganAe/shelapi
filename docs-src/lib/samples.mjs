// Génère les exemples de code (curl, JavaScript, Python, SDK OpenAI) à partir de la description d'une requête.
// Tout est calculé depuis la spécification OpenAPI : les exemples ne peuvent pas se désynchroniser de l'API.
import { BASE_URL } from "./carbon.mjs";

const IDENT = /^[A-Za-z_$][\w$]*$/;
const MAX_INLINE = 64;

/** Littéral JavaScript lisible : clés sans guillemets, retours à la ligne au-delà de 64 caractères. */
export function jsLiteral(value, indent = 0) {
  const pad = " ".repeat(indent);
  const padIn = " ".repeat(indent + 2);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const inline = `[${value.map((v) => jsLiteral(v)).join(", ")}]`;
    if (inline.length <= MAX_INLINE && !inline.includes("\n")) return inline;
    return `[\n${value.map((v) => padIn + jsLiteral(v, indent + 2)).join(",\n")},\n${pad}]`;
  }
  const key = (k) => (IDENT.test(k) ? k : JSON.stringify(k));
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  const inline = `{ ${entries.map(([k, v]) => `${key(k)}: ${jsLiteral(v)}`).join(", ")} }`;
  if (inline.length <= MAX_INLINE && !inline.includes("\n")) return inline;
  return `{\n${entries.map(([k, v]) => `${padIn}${key(k)}: ${jsLiteral(v, indent + 2)}`).join(",\n")},\n${pad}}`;
}

/** Littéral Python (True / False / None, clés entre guillemets). */
export function pyLiteral(value, indent = 0) {
  const pad = " ".repeat(indent);
  const padIn = " ".repeat(indent + 4);
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    const inline = `[${value.map((v) => pyLiteral(v)).join(", ")}]`;
    if (inline.length <= MAX_INLINE && !inline.includes("\n")) return inline;
    return `[\n${value.map((v) => padIn + pyLiteral(v, indent + 4)).join(",\n")},\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  const inline = `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`).join(", ")}}`;
  if (inline.length <= MAX_INLINE && !inline.includes("\n")) return inline;
  return `{\n${entries.map(([k, v]) => `${padIn}${JSON.stringify(k)}: ${pyLiteral(v, indent + 4)}`).join(",\n")},\n${pad}}`;
}

const indentLines = (text, spaces) => text.split("\n").map((l, i) => (i === 0 ? l : " ".repeat(spaces) + l)).join("\n");

// ---------------------------------------------------------------- curl
function curl({ url, body, stream, auth }) {
  const lines = [`curl ${stream ? "-N " : ""}${url}`];
  if (auth) lines.push('-H "Authorization: Bearer $GATEWAY_KEY"');
  if (body) lines.push('-H "Content-Type: application/json"');
  let heredoc = "";
  if (body) {
    const json = JSON.stringify(body, null, 2);
    if (json.includes("'")) {
      // Une apostrophe casserait les guillemets simples du shell : on passe par un « here-document ».
      lines.push("-d @-");
      heredoc = ` <<'JSON'\n${json}\nJSON`;
    } else {
      lines.push(`-d '${json}'`); // -d implique POST
    }
  }
  return lines.join(" \\\n  ") + heredoc;
}

// ---------------------------------------------------------------- JavaScript (fetch)
function javascript({ method, url, body, stream, auth }) {
  const headers = [];
  if (auth) headers.push("Authorization: `Bearer ${process.env.GATEWAY_KEY}`");
  if (body) headers.push('"Content-Type": "application/json"');
  const options = [];
  if (method !== "GET") options.push(`method: "${method}"`);
  if (headers.length) options.push(`headers: {\n${headers.map((h) => `    ${h},`).join("\n")}\n  }`);
  if (body) options.push(`body: JSON.stringify(${indentLines(jsLiteral(body, 2), 0)})`);
  const call = options.length ? `fetch("${url}", {\n${options.map((o) => `  ${indentLines(o, 0)},`).join("\n")}\n})` : `fetch("${url}")`;

  const failure = auth || body
    ? `if (!response.ok) {\n  const { error } = await response.json();\n  throw new Error(\`\${error.code} : \${error.message} (requête \${error.request_id})\`);\n}\n`
    : "";

  if (stream) {
    return `const response = await ${call};\n\n${failure}\nconst reader = response.body.pipeThrough(new TextDecoderStream()).getReader();\nlet buffer = "";\n\nfor (;;) {\n  const { done, value } = await reader.read();\n  if (done) break;\n  buffer += value;\n\n  const events = buffer.split(/\\r?\\n\\r?\\n/);\n  buffer = events.pop(); // événement incomplet : on attend la suite\n\n  for (const event of events) {\n    const data = event.replace(/^data: /, "");\n    if (data === "[DONE]") continue;\n    const chunk = JSON.parse(data);\n    if (chunk.error) throw new Error(chunk.error.message); // coupure en cours de flux\n    process.stdout.write(chunk.choices[0]?.delta?.content ?? "");\n  }\n}`;
  }
  const result = body && body.messages ? "console.log(data.choices[0].message.content);" : "console.log(data);";
  return `const response = await ${call};\n\n${failure ? `${failure}\n` : ""}const data = await response.json();\n${result}`;
}

// ---------------------------------------------------------------- Python (requests)
function python({ method, url, body, stream, auth }) {
  const args = [`    "${url}",`];
  if (auth) args.push(`    headers={"Authorization": f"Bearer {os.environ['GATEWAY_KEY']}"},`);
  if (body) args.push(`    json=${pyLiteral(body, 4)},`);
  if (stream) args.push("    stream=True,");
  args.push("    timeout=60,");
  const request = `requests.${method.toLowerCase()}(\n${args.join("\n")}\n)`;

  const stdlib = [stream && "import json", auth && "import os"].filter(Boolean);
  const imports = `${stdlib.length ? `${stdlib.join("\n")}\n\n` : ""}import requests\n`;

  const failure = `if not response.ok:\n    error = response.json()["error"]\n    raise RuntimeError(f"{error['code']} : {error['message']} (requête {error['request_id']})")\n`;
  const checked = auth || body;

  if (stream) {
    const guard = checked ? `${failure.replace(/^(?=.)/gm, "    ")}\n` : "";
    return `${imports}\nwith ${request} as response:\n${guard}    for line in response.iter_lines(decode_unicode=True):\n        if not line.startswith("data: "):\n            continue\n        data = line[len("data: "):]\n        if data == "[DONE]":\n            break\n        chunk = json.loads(data)\n        if "error" in chunk:\n            raise RuntimeError(chunk["error"]["message"])  # coupure en cours de flux\n        for choice in chunk.get("choices") or []:\n            print(choice["delta"].get("content") or "", end="", flush=True)`;
  }
  const result = body?.messages ? 'print(response.json()["choices"][0]["message"]["content"])' : "print(response.json())";
  return `${imports}\nresponse = ${request}\n\n${checked ? `${failure}\n` : ""}${result}`;
}

// ---------------------------------------------------------------- SDK OpenAI
function openaiJs({ body, stream }) {
  const { model = "auto", messages, ...rest } = body;
  const call = `await client.chat.completions.create(${jsLiteral({ model, messages, ...rest })})`;
  const head = `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${BASE_URL}/v1",\n  apiKey: process.env.GATEWAY_KEY,\n});\n\n`;
  if (stream) return `${head}const stream = ${call};\n\nfor await (const chunk of stream) {\n  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");\n}`;
  return `${head}const completion = ${call};\n\nconsole.log(completion.choices[0].message.content);`;
}

function openaiPy({ body, stream }) {
  const params = Object.entries(body).map(([k, v]) => `    ${k}=${pyLiteral(v, 4)},`).join("\n");
  const head = `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    base_url="${BASE_URL}/v1",\n    api_key=os.environ["GATEWAY_KEY"],\n)\n\n`;
  const call = `client.chat.completions.create(\n${params}\n)`;
  if (stream) return `${head}stream = ${call}\n\nfor chunk in stream:\n    if chunk.choices:\n        print(chunk.choices[0].delta.content or "", end="", flush=True)`;
  return `${head}completion = ${call}\n\nprint(completion.choices[0].message.content)`;
}

/**
 * Exemples pour une requête.
 * @param {{method: string, path: string, body?: object, auth?: boolean, sdk?: boolean}} request
 * @returns {{key: string, label: string, lang: string, code: string}[]}
 */
export function samples({ method, path, body, auth = true, sdk = false }) {
  const stream = body?.stream === true;
  const ctx = { method: method.toUpperCase(), url: `${BASE_URL}${path}`, body, stream, auth };
  const list = [
    { key: "curl", label: "curl", lang: "bash", code: curl(ctx) },
    { key: "js", label: "JavaScript", lang: "javascript", code: javascript(ctx) },
    { key: "python", label: "Python", lang: "python", code: python(ctx) },
  ];
  if (sdk && body) {
    list.push({ key: "openai-js", label: "SDK OpenAI (JS)", lang: "javascript", code: openaiJs(ctx) });
    list.push({ key: "openai-py", label: "SDK OpenAI (Python)", lang: "python", code: openaiPy(ctx) });
  }
  return list;
}
