# Shel API — passerelle IA compatible OpenAI

[![CI](https://github.com/MeganAe/shelapi/actions/workflows/ci.yml/badge.svg)](https://github.com/MeganAe/shelapi/actions/workflows/ci.yml)

Une seule API, au format d'OpenAI, qui répartit vos requêtes entre **Groq**, **Google Gemini** et **Cloudflare Workers AI**
et bascule automatiquement vers un autre modèle quand l'un d'eux atteint sa limite, tombe en panne ou ne répond pas à temps.

- **Compatible OpenAI** : gardez vos SDK et vos outils, changez seulement l'URL de base et la clé.
- **Bascule automatique** avec mise en pause des modèles défaillants, délai total garanti, streaming (SSE).
- **Une clé par projet** ; les clés des fournisseurs restent sur le serveur.
- **Sans dépendance** : Node.js 20.12+ suffit. Déployable sur Vercel en quelques minutes.
- **Documentation interactive** sur `/docs/` et spécification **OpenAPI 3.1** sur `/openapi.json`.

## Démarrage rapide

```bash
cp .env.example .env   # renseignez GATEWAY_KEYS et au moins une clé de fournisseur
npm start              # http://localhost:3000  (documentation : http://localhost:3000/docs/)
```

Pas encore de clés ? `npm run preview` lance la passerelle et la documentation avec de **faux fournisseurs**
(réponses simulées, aucun appel Internet) : pratique pour découvrir le terrain de jeu et la bascule.

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Bonjour !"}]}'
```

Avec un SDK OpenAI, changez uniquement `baseURL` (l'adresse de la passerelle suivie de `/v1`) et `apiKey`.
Les exemples complets (curl, JavaScript, Python, SDK, streaming) sont dans la documentation.

## Routes

| Route | Clé | Rôle |
| --- | :---: | --- |
| `POST /v1/chat/completions` | oui | Chat au format OpenAI, avec bascule et streaming |
| `GET /v1/models` | oui | Modèles utilisables (`auto`, puis `fournisseur/modèle`) |
| `GET /groq` · `POST /groq/<modèle>` | oui | Un point d'accès dédié par modèle Groq, sans bascule |
| `GET /health` | non | Sonde de disponibilité |
| `GET /` | non | Statut (JSON) ; un navigateur est redirigé vers `/docs/` |
| `GET /openapi.json` | non | Spécification OpenAPI 3.1 |
| `GET /docs/` | non | Documentation |

Le champ `model` pilote le routage : `auto` (ou absent, ou inconnu) essaie tous les fournisseurs dans l'ordre ;
`groq`, `gemini` ou `cloudflare` limite à un fournisseur ; `fournisseur/modèle` impose un modèle précis, sans bascule.

## Configuration

Toute la configuration passe par des variables d'environnement, décrites dans [`.env.example`](.env.example)
et dans la documentation (`/docs/`, section « Configuration et déploiement »).

| Variable | Rôle |
| --- | --- |
| `GATEWAY_KEYS` | **Requise.** Clés autorisées à appeler l'API, séparées par des virgules (16 caractères minimum) |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | Clés des fournisseurs (un fournisseur sans clé est désactivé) |
| `GROQ_MODEL`, `GEMINI_MODEL`, `CLOUDFLARE_MODEL` | Modèles préférés, listes séparées par des virgules |
| `TIMEOUT_MS`, `DEADLINE_MS` | Durée d'une tentative / durée totale d'une requête |
| `MAX_BODY_BYTES`, `CORS_ORIGINS`, `LOG_LEVEL` | Taille maximale, origines CORS, verbosité des journaux |

Générer une clé solide :

```bash
node -e "console.log(crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''))"
```

> **Les noms de modèles changent souvent.** Les valeurs par défaut ont été vérifiées dans la documentation des
> fournisseurs le 2 octobre 2026 ; si un modèle est retiré, la passerelle bascule d'elle-même sur le suivant, mais
> mettez à jour `GROQ_MODEL`, `GEMINI_MODEL` et `CLOUDFLARE_MODEL` pour retrouver un fonctionnement optimal.

## Déploiement sur Vercel

1. Importez le dépôt dans Vercel (aucune commande de build : le dossier `public/` et la fonction `api/index.js` sont déjà déclarés dans `vercel.json`).
2. Ajoutez les variables d'environnement (*Settings → Environment Variables*), puis déployez.
3. Vérifiez `https://votre-projet.vercel.app/health`, puis `/docs/`.

`vercel.json` limite la durée de la fonction à 60 s (`maxDuration`). Si votre offre Vercel refuse cette valeur,
baissez-la, ainsi que `DEADLINE_MS` (qui doit rester inférieure).

## Développement

```bash
npm test               # tests (node:test, aucune dépendance) — plus de cent cas, y compris la documentation et l'aperçu
npm run preview        # passerelle + documentation avec de faux fournisseurs
npm run docs:install   # une fois : outils de génération de la documentation (docs-src/)
npm run docs:build     # régénère public/docs/index.html (à lancer quand l'API ou les textes changent)
```

| Fichier | Rôle |
| --- | --- |
| `api/index.js` | Point d'entrée Vercel (fonction serverless) |
| `local.js` | Serveur local : documentation (`public/`) puis API |
| `src/handler.js` | Routeur, journal d'accès, filet de sécurité (aucune exception ne s'échappe) |
| `src/chat.js` | Bascule, pauses, délais, streaming, choix du statut HTTP en cas d'échec |
| `src/providers.js` | Modèles Groq (cache), chaîne de modèles selon le champ `model` |
| `src/config.js` | Lecture et validation des variables d'environnement |
| `src/http.js` | Erreurs normalisées, CORS, authentification, lecture du corps |
| `src/openapi.js` | Spécification OpenAPI : **source unique** de la documentation, de `/openapi.json` et des tests |
| `src/static.js` | Fichiers statiques (serveur local uniquement ; sur Vercel, c'est le CDN) |
| `public/docs/index.html` | Documentation **générée** : ne la modifiez pas à la main |
| `docs-src/` | Générateur de la documentation ([Carbon Design System](https://carbondesignsystem.com)) |
| `tests/` | Tests unitaires et d'intégration avec de faux fournisseurs |

Pour ajouter ou modifier une route : mettez à jour `src/handler.js` **et** `src/openapi.js`, puis lancez `npm run docs:build`.
Les tests vérifient que chaque route documentée existe, que la documentation correspond à l'API et que `.env.example` décrit les mêmes variables que la documentation.

## Dépannage

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| `503 server_misconfigured` | `GATEWAY_KEYS` est vide | Définissez au moins une clé |
| `401 invalid_api_key` | La clé n'est pas dans `GATEWAY_KEYS` | Vérifiez la clé (espaces, copier-coller) |
| `502 upstream_auth_error` | Une clé de fournisseur est refusée | Vérifiez `GROQ_API_KEY`, `GEMINI_API_KEY`, `CLOUDFLARE_*` |
| `404 model_not_found`, ou « model_decommissioned » dans les journaux | Un modèle a été retiré | Mettez à jour `*_MODEL` (voir les pages « deprecations » des fournisseurs) |
| `429 rate_limited` | Tous les modèles ont atteint leur quota | Attendez le `Retry-After`, ajoutez d'autres fournisseurs ou modèles |
| `504 deadline_exceeded` | La requête dépasse `DEADLINE_MS` | Demandez une réponse plus courte (`max_tokens`) ou utilisez le streaming |

Chaque réponse porte un en-tête `X-Request-Id`, repris dans les journaux : c'est le moyen le plus rapide de retrouver une requête.

## Sécurité

- Les clés sont comparées en temps constant ; les journaux n'écrivent jamais le corps des requêtes, les clés ni les paramètres d'URL (seule une empreinte courte de la clé apparaît, `clé=9fce2e`).
- Au démarrage, la passerelle signale dans ses journaux les clés d'exemple ou trop courtes.
- Ne committez jamais `.env`. Si l'ancien exemple `cle-projet-1,cle-projet-2` a servi quelque part, **remplacez ces clés** : elles sont publiques.
- Ne placez jamais une clé dans une application web publique ou mobile : appelez la passerelle depuis votre serveur.
- Restreignez `CORS_ORIGINS` si seule une application web connue appelle la passerelle.
