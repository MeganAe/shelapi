// Empreinte des données de l'API dont dépend la documentation (spécification OpenAPI, codes d'erreur, valeurs par
// défaut, durées de pause, version). Elle est inscrite dans la page à la génération ; tests/docs.test.js la recalcule
// et échoue si l'API a changé sans que la documentation ait été régénérée (`npm run docs:build`).
// N'importe QUE des modules de src/ : aucune dépendance de docs-src n'est nécessaire pour la calculer.
import { createHash } from "node:crypto";
import { COOLDOWN } from "../../src/chat.js";
import { DEFAULTS, loadConfig } from "../../src/config.js";
import { ERRORS } from "../../src/http.js";
import { buildOpenApi } from "../../src/openapi.js";
import { VERSION } from "../../src/version.js";

export function sourceHash() {
  const data = JSON.stringify({ spec: buildOpenApi({ serverUrl: "https://exemple.invalid" }), errors: ERRORS, defaults: DEFAULTS, config: loadConfig({}), cooldown: COOLDOWN, version: VERSION });
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}
