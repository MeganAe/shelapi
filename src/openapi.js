// =====================================================================
//  Spécification OpenAPI 3.1 de l'API — source unique de vérité.
//  Utilisée par : GET /openapi.json, la page de documentation (docs-src/build.mjs) et les tests.
//  Quand vous ajoutez ou modifiez une route, mettez à jour CE fichier puis relancez `npm run docs:build`.
// =====================================================================
import { ERRORS } from "./http.js";
import { VERSION } from "./version.js";

const EXAMPLE_ID = "req_3f9a1c7e2b5d4a60";

/** Exemple d'erreur construit à partir du catalogue (le texte reste toujours synchrone avec le code). */
function errorExample(code, { status, message, param = null, details } = {}) {
  const def = ERRORS[code];
  const error = { message: message ?? def.message, type: def.type, code, param, request_id: EXAMPLE_ID };
  if (details) error.details = details;
  return { value: { error }, summary: `${status ?? def.status} · ${code}` };
}

const errorBody = (examples) => ({
  "application/json": { schema: { $ref: "#/components/schemas/Error" }, examples },
});

const retryAfterHeader = {
  "Retry-After": { description: "Nombre de secondes à attendre avant de réessayer.", schema: { type: "integer", minimum: 0 }, example: 30 },
};

const chatCompletionExample = {
  id: "chatcmpl-9f2c1d",
  object: "chat.completion",
  created: 1790000000,
  model: "openai/gpt-oss-120b",
  choices: [{ index: 0, message: { role: "assistant", content: "Bonjour ! Comment puis-je vous aider aujourd'hui ?" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 12, completion_tokens: 11, total_tokens: 23 },
};

const sseExample = [
  'data: {"id":"chatcmpl-9f2c1d","object":"chat.completion.chunk","created":1790000000,"model":"openai/gpt-oss-120b","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-9f2c1d","object":"chat.completion.chunk","created":1790000000,"model":"openai/gpt-oss-120b","choices":[{"index":0,"delta":{"content":"Bonjour"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-9f2c1d","object":"chat.completion.chunk","created":1790000000,"model":"openai/gpt-oss-120b","choices":[{"index":0,"delta":{"content":" !"},"finish_reason":null}]}',
  "",
  'data: {"id":"chatcmpl-9f2c1d","object":"chat.completion.chunk","created":1790000000,"model":"openai/gpt-oss-120b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  "",
  "data: [DONE]",
].join("\n");

const responseHeaders = {
  "X-Request-Id": { description: "Identifiant unique de la requête (à donner en cas de problème). Repris de la requête s'il est fourni.", schema: { type: "string" }, example: EXAMPLE_ID },
  "X-Provider": { description: "Fournisseur qui a réellement répondu.", schema: { type: "string", enum: ["groq", "gemini", "cloudflare"] }, example: "groq" },
  "X-Model": { description: "Modèle qui a réellement répondu.", schema: { type: "string" }, example: "openai/gpt-oss-120b" },
};

const security = [{ bearerAuth: [] }];

function buildBase() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Shel API — AI Gateway",
      version: VERSION,
      summary: "Passerelle IA compatible OpenAI avec bascule automatique entre Groq, Gemini et Cloudflare Workers AI.",
      description:
        "Une seule API, un seul format (celui d'OpenAI), plusieurs fournisseurs d'IA. " +
        "Si un modèle atteint sa limite ou tombe en panne, la passerelle essaie automatiquement le suivant.\n\n" +
        "Compatible avec les SDK OpenAI : il suffit de changer `baseURL` et `apiKey`.",
    },
    servers: [{ url: "http://localhost:3000", description: "Passerelle" }],
    tags: [
      { name: "Chat", description: "Génération de texte (format OpenAI Chat Completions)." },
      { name: "Modèles", description: "Découvrir les modèles disponibles." },
      { name: "Groq", description: "Un endpoint dédié par modèle Groq, sans bascule automatique." },
      { name: "Système", description: "Santé et métadonnées de la passerelle." },
    ],
    security,
    paths: {
      "/v1/chat/completions": {
        post: {
          operationId: "createChatCompletion",
          tags: ["Chat"],
          summary: "Créer une réponse de chat",
          description:
            "Envoyez une conversation et recevez la réponse du modèle. Le format est identique à `POST /v1/chat/completions` d'OpenAI.\n\n" +
            "Le champ `model` pilote le **routage** :\n\n" +
            "- `auto` (ou absent) : la passerelle essaie tous les modèles de tous les fournisseurs configurés, dans l'ordre, jusqu'à obtenir une réponse ;\n" +
            "- `groq`, `gemini` ou `cloudflare` : seuls les modèles de ce fournisseur sont essayés ;\n" +
            "- `fournisseur/modèle` (ex. `groq/openai/gpt-oss-120b`) : ce modèle précis est utilisé, **sans** bascule.\n\n" +
            "Une valeur inconnue (par exemple `gpt-4o`, souvent imposée par un SDK) est traitée comme `auto`. " +
            "Les en-têtes `X-Provider` et `X-Model` indiquent qui a réellement répondu.\n\n" +
            "Avec `stream: true`, la réponse est envoyée en direct au format Server-Sent Events.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatCompletionRequest" },
                examples: {
                  simple: {
                    summary: "Question simple (bascule automatique)",
                    value: { model: "auto", messages: [{ role: "user", content: "Bonjour !" }] },
                  },
                  systeme: {
                    summary: "Avec un message système et des réglages",
                    value: {
                      model: "auto",
                      messages: [
                        { role: "system", content: "Tu es un assistant concis. Réponds en français." },
                        { role: "user", content: "Explique ce qu'est une API REST en deux phrases." },
                      ],
                      temperature: 0.3,
                      max_tokens: 200,
                    },
                  },
                  modele_precis: {
                    summary: "Modèle précis, sans bascule",
                    value: { model: "groq/openai/gpt-oss-120b", messages: [{ role: "user", content: "Bonjour !" }] },
                  },
                  streaming: {
                    summary: "Réponse en streaming",
                    value: { model: "auto", stream: true, messages: [{ role: "user", content: "Raconte une courte blague." }] },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Réponse du modèle (JSON), ou flux d'événements si `stream` vaut `true`.",
              headers: responseHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChatCompletion" },
                  examples: { reponse: { summary: "Réponse standard", value: chatCompletionExample } },
                },
                "text/event-stream": {
                  schema: { type: "string", description: "Suite d'événements `data: {...}` terminée par `data: [DONE]`." },
                  examples: { flux: { summary: "Flux SSE", value: sseExample } },
                },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            401: { $ref: "#/components/responses/Unauthorized" },
            413: { $ref: "#/components/responses/PayloadTooLarge" },
            429: { $ref: "#/components/responses/RateLimited" },
            502: { $ref: "#/components/responses/BadGateway" },
            503: { $ref: "#/components/responses/ServiceUnavailable" },
            504: { $ref: "#/components/responses/GatewayTimeout" },
          },
        },
      },

      "/v1/models": {
        get: {
          operationId: "listModels",
          tags: ["Modèles"],
          summary: "Lister les modèles",
          description:
            "Retourne `auto` puis tous les modèles utilisables sous la forme `fournisseur/modèle`. " +
            "La liste Groq est récupérée automatiquement auprès de Groq (cache d'une heure). Les identifiants retournés sont directement utilisables dans le champ `model`.",
          responses: {
            200: {
              description: "Liste des modèles.",
              headers: { "X-Request-Id": responseHeaders["X-Request-Id"] },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ModelList" },
                  examples: {
                    liste: {
                      value: {
                        object: "list",
                        data: [
                          { id: "auto", object: "model", created: 1790000000, owned_by: "gateway" },
                          { id: "groq/openai/gpt-oss-120b", object: "model", created: 1790000000, owned_by: "groq" },
                          { id: "groq/openai/gpt-oss-20b", object: "model", created: 1790000000, owned_by: "groq" },
                          { id: "gemini/gemini-3.8-flash", object: "model", created: 1790000000, owned_by: "gemini" },
                          { id: "cloudflare/@cf/meta/llama-3.1-8b-instruct-fp8", object: "model", created: 1790000000, owned_by: "cloudflare" },
                        ],
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            503: { $ref: "#/components/responses/ServiceUnavailable" },
          },
        },
      },

      "/groq": {
        get: {
          operationId: "listGroqEndpoints",
          tags: ["Groq"],
          summary: "Lister les endpoints Groq",
          description: "Retourne un endpoint dédié pour chaque modèle de chat Groq actif. Pratique pour configurer un outil qui n'accepte qu'une URL par modèle.",
          responses: {
            200: {
              description: "Modèles Groq et leur endpoint.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GroqEndpointList" },
                  examples: {
                    liste: {
                      value: {
                        provider: "groq",
                        count: 2,
                        models: [
                          { id: "openai/gpt-oss-120b", endpoint: "https://votre-projet.vercel.app/groq/openai/gpt-oss-120b" },
                          { id: "openai/gpt-oss-20b", endpoint: "https://votre-projet.vercel.app/groq/openai/gpt-oss-20b" },
                        ],
                      },
                    },
                  },
                },
              },
            },
            401: { $ref: "#/components/responses/Unauthorized" },
            503: { $ref: "#/components/responses/ServiceUnavailable" },
          },
        },
      },

      "/groq/{model}": {
        post: {
          operationId: "createGroqChatCompletion",
          tags: ["Groq"],
          summary: "Chat avec un modèle Groq précis",
          description:
            "Même corps et même réponse que `POST /v1/chat/completions`, mais le modèle est choisi par l'URL et **aucune bascule** n'est faite : " +
            "si Groq refuse, l'erreur est renvoyée telle quelle. Le champ `model` du corps est ignoré.\n\n" +
            "L'identifiant du modèle peut contenir des `/` (ex. `/groq/openai/gpt-oss-120b`). " +
            "Les suffixes `/chat/completions` et `/v1/chat/completions` sont acceptés, ce qui permet d'utiliser l'URL comme `baseURL` d'un SDK OpenAI.",
          parameters: [
            {
              name: "model",
              in: "path",
              required: true,
              description: "Identifiant du modèle Groq (voir `GET /groq`). Peut contenir des `/`.",
              schema: { type: "string" },
              example: "openai/gpt-oss-120b",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ChatCompletionRequest" },
                examples: { simple: { summary: "Question simple", value: { messages: [{ role: "user", content: "Bonjour !" }] } } },
              },
            },
          },
          responses: {
            200: {
              description: "Réponse du modèle (même format que `/v1/chat/completions`).",
              headers: responseHeaders,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ChatCompletion" }, examples: { reponse: { value: chatCompletionExample } } },
                "text/event-stream": { schema: { type: "string" }, examples: { flux: { value: sseExample } } },
              },
            },
            400: { $ref: "#/components/responses/BadRequest" },
            401: { $ref: "#/components/responses/Unauthorized" },
            404: { $ref: "#/components/responses/NotFound" },
            413: { $ref: "#/components/responses/PayloadTooLarge" },
            429: { $ref: "#/components/responses/RateLimited" },
            502: { $ref: "#/components/responses/BadGateway" },
            503: { $ref: "#/components/responses/ServiceUnavailable" },
            504: { $ref: "#/components/responses/GatewayTimeout" },
          },
        },
      },

      "/health": {
        get: {
          operationId: "getHealth",
          tags: ["Système"],
          summary: "Vérifier que l'API tourne",
          description: "Aucune clé requise. Idéal pour une sonde de disponibilité (UptimeRobot, etc.).",
          security: [],
          responses: {
            200: {
              description: "La passerelle fonctionne.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Health" },
                  examples: { ok: { value: { status: "ok", version: VERSION, uptime_s: 3600 } } },
                },
              },
            },
          },
        },
      },

      "/": {
        get: {
          operationId: "getRoot",
          tags: ["Système"],
          summary: "Statut et lien vers la documentation",
          description:
            "Les navigateurs (`Accept: text/html`) sont redirigés vers la documentation. Les autres clients reçoivent un JSON de statut. " +
            "La liste des fournisseurs actifs n'est incluse que si une clé valide est fournie.",
          security: [],
          responses: {
            200: {
              description: "Statut de la passerelle.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Root" },
                  examples: { ok: { value: { status: "ok", service: "ai-gateway", version: VERSION, docs: "https://votre-projet.vercel.app/docs/" } } },
                },
              },
            },
            302: { description: "Redirection vers `/docs/` pour les navigateurs." },
          },
        },
      },
    },

    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "Clé projet définie dans la variable d'environnement `GATEWAY_KEYS` du serveur (une clé par projet). " +
            "Envoyez-la dans l'en-tête `Authorization: Bearer <clé>`. L'en-tête `X-Api-Key: <clé>` est aussi accepté.",
        },
      },

      responses: {
        BadRequest: {
          description: "Requête invalide : JSON illisible, champ manquant ou mauvais type, ou requête refusée par le fournisseur.",
          content: errorBody({
            json: errorExample("invalid_json"),
            champ: errorExample("invalid_request", { message: "Le champ « messages » est requis : un tableau non vide.", param: "messages" }),
            refus: errorExample("upstream_rejected", { message: "groq a refusé la requête : `temperature` doit être comprise entre 0 et 2.", status: 400 }),
          }),
        },
        Unauthorized: {
          description: "Clé API absente ou invalide.",
          headers: { "WWW-Authenticate": { description: "Schéma d'authentification attendu.", schema: { type: "string" }, example: 'Bearer realm="ai-gateway"' } },
          content: errorBody({ absente: errorExample("missing_api_key"), invalide: errorExample("invalid_api_key") }),
        },
        NotFound: {
          description: "Route ou modèle introuvable.",
          content: errorBody({
            route: errorExample("not_found"),
            modele: errorExample("model_not_found", { message: "Modèle Groq inconnu : mon-modele. Utilisez GET /groq pour la liste des endpoints.", param: "model" }),
          }),
        },
        PayloadTooLarge: { description: "Corps de la requête trop volumineux (4 Mo par défaut).", content: errorBody({ trop_gros: errorExample("payload_too_large") }) },
        RateLimited: {
          description: "Tous les modèles ont atteint leur limite (ou sont en pause). Réessayez après le délai indiqué.",
          headers: retryAfterHeader,
          content: errorBody({ limite: errorExample("rate_limited", { details: [{ provider: "groq", model: "openai/gpt-oss-120b", status: 429, kind: "rate_limit" }] }) }),
        },
        BadGateway: {
          description: "Tous les fournisseurs ont échoué (ou la clé d'un fournisseur est refusée).",
          content: errorBody({
            echec: errorExample("upstream_error", {
              details: [
                { provider: "groq", model: "openai/gpt-oss-120b", status: 503, kind: "server", message: "Service temporarily unavailable" },
                { provider: "gemini", model: "gemini-3.8-flash", kind: "timeout" },
              ],
            }),
            cle: errorExample("upstream_auth_error"),
          }),
        },
        ServiceUnavailable: {
          description: "La passerelle n'est pas (entièrement) configurée.",
          content: errorBody({
            aucun: errorExample("no_provider_configured"),
            fournisseur: errorExample("provider_not_configured", { message: "GROQ_API_KEY n'est pas configurée sur la passerelle." }),
            cles: errorExample("server_misconfigured"),
          }),
        },
        GatewayTimeout: {
          description: "Le délai maximal a été dépassé avant d'obtenir une réponse.",
          content: errorBody({ delai: errorExample("deadline_exceeded"), fournisseur: errorExample("upstream_timeout") }),
        },
      },

      schemas: {
        ChatCompletionRequest: {
          type: "object",
          required: ["messages"],
          additionalProperties: true,
          description:
            "Corps compatible OpenAI. Les paramètres non listés ici (`tools`, `response_format`, `reasoning_effort`…) sont transmis tels quels au fournisseur : leur prise en charge dépend du modèle choisi.",
          properties: {
            messages: {
              type: "array",
              minItems: 1,
              description: "La conversation, du plus ancien au plus récent message.",
              items: { $ref: "#/components/schemas/ChatMessage" },
            },
            model: {
              type: "string",
              default: "auto",
              description: "Routage : `auto`, un fournisseur (`groq`, `gemini`, `cloudflare`) ou `fournisseur/modèle`. Une valeur inconnue équivaut à `auto`.",
              examples: ["auto", "groq", "groq/openai/gpt-oss-120b", "gemini", "cloudflare/@cf/meta/llama-3.1-8b-instruct-fp8"],
            },
            stream: { type: "boolean", default: false, description: "Si `true`, la réponse est envoyée en direct (Server-Sent Events). Doit être un booléen." },
            temperature: { type: "number", minimum: 0, maximum: 2, description: "Créativité : 0 = très déterministe, 2 = très aléatoire." },
            top_p: { type: "number", minimum: 0, maximum: 1, description: "Échantillonnage par noyau (alternative à `temperature`)." },
            max_tokens: { type: "integer", minimum: 1, description: "Nombre maximal de tokens générés." },
            stop: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, maxItems: 4 }], description: "Séquence(s) qui arrêtent la génération." },
            seed: { type: "integer", description: "Graine pour des réponses reproductibles (selon le fournisseur)." },
          },
        },
        ChatMessage: {
          type: "object",
          required: ["role"],
          additionalProperties: true,
          properties: {
            role: { type: "string", enum: ["system", "user", "assistant", "tool", "developer"], description: "Auteur du message." },
            content: {
              oneOf: [{ type: "string" }, { type: "array", items: { type: "object" } }, { type: "null" }],
              description: "Texte du message, ou liste de parties (texte, images…) pour les modèles qui les acceptent.",
            },
            name: { type: "string", description: "Nom optionnel de l'auteur." },
          },
        },
        ChatCompletion: {
          type: "object",
          description: "Réponse standard OpenAI, transmise sans modification depuis le fournisseur.",
          properties: {
            id: { type: "string" },
            object: { type: "string", const: "chat.completion" },
            created: { type: "integer", description: "Horodatage Unix (secondes)." },
            model: { type: "string", description: "Modèle qui a répondu." },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  message: { type: "object", properties: { role: { type: "string" }, content: { type: ["string", "null"] } } },
                  finish_reason: { type: ["string", "null"], examples: ["stop", "length", "tool_calls"] },
                },
              },
            },
            usage: {
              type: "object",
              properties: { prompt_tokens: { type: "integer" }, completion_tokens: { type: "integer" }, total_tokens: { type: "integer" } },
            },
          },
        },
        ModelList: {
          type: "object",
          properties: {
            object: { type: "string", const: "list" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Valeur à mettre dans le champ `model`." },
                  object: { type: "string", const: "model" },
                  created: { type: "integer" },
                  owned_by: { type: "string", description: "`gateway`, `groq`, `gemini` ou `cloudflare`." },
                },
              },
            },
          },
        },
        GroqEndpointList: {
          type: "object",
          properties: {
            provider: { type: "string", const: "groq" },
            count: { type: "integer" },
            models: { type: "array", items: { type: "object", properties: { id: { type: "string" }, endpoint: { type: "string", format: "uri" } } } },
          },
        },
        Health: {
          type: "object",
          properties: { status: { type: "string", const: "ok" }, version: { type: "string" }, uptime_s: { type: "integer", description: "Secondes depuis le démarrage de l'instance." } },
        },
        Root: {
          type: "object",
          properties: {
            status: { type: "string", const: "ok" },
            service: { type: "string" },
            version: { type: "string" },
            docs: { type: "string", format: "uri" },
            providers: { type: "array", items: { type: "string" }, description: "Fournisseurs actifs (uniquement avec une clé valide)." },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["message", "type", "code", "request_id"],
              properties: {
                message: { type: "string", description: "Explication lisible, en français." },
                type: { type: "string", enum: [...new Set(Object.values(ERRORS).map((e) => e.type))], description: "Catégorie générale de l'erreur." },
                code: { type: "string", enum: Object.keys(ERRORS), description: "Code stable à utiliser dans votre programme (voir la liste des erreurs)." },
                param: { type: ["string", "null"], description: "Champ de la requête en cause, s'il y en a un." },
                request_id: { type: "string", description: "Identifiant de la requête (aussi dans l'en-tête `X-Request-Id`)." },
                details: {
                  type: "array",
                  description: "Une entrée par modèle essayé, quand la bascule a échoué.",
                  items: {
                    type: "object",
                    properties: {
                      provider: { type: "string" },
                      model: { type: "string" },
                      status: { type: "integer", description: "Statut HTTP renvoyé par le fournisseur, s'il a répondu." },
                      kind: { type: "string", enum: ["rate_limit", "cooling", "auth", "model_unavailable", "server", "timeout", "network", "client", "deadline"] },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

const BASE = buildBase();

/** Spécification complète ; `serverUrl` = URL publique de la passerelle (déduite de la requête). */
export function buildOpenApi({ serverUrl } = {}) {
  const spec = structuredClone(BASE);
  if (serverUrl) spec.servers = [{ url: serverUrl, description: "Cette passerelle" }];
  return spec;
}
