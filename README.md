# AI Gateway (prêt pour Vercel)

API REST compatible OpenAI qui regroupe Groq, Gemini et Cloudflare Workers AI,
avec fallback automatique et un endpoint par modèle Groq.

## Déploiement sur Vercel

### Option A : avec GitHub (recommandé)
1. Dézippe ce dossier et envoie-le sur un dépôt GitHub (le `.env` est ignoré par `.gitignore`).
2. Sur vercel.com : **Add New → Project**, importe le dépôt.
3. Framework Preset : **Other**. Ne change rien d'autre.
4. Ouvre **Environment Variables** et ajoute :
   `GATEWAY_KEYS`, `GROQ_API_KEY`, `GEMINI_API_KEY`,
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
5. Clique sur **Deploy**.

### Option B : avec la ligne de commande
```
npm i -g vercel
vercel          # première fois : répond aux questions
vercel env add GATEWAY_KEYS      # idem pour les autres variables
vercel --prod
```

Après toute modification des variables d'environnement, redéploie le projet.

## Utilisation
Remplace `https://TON-PROJET.vercel.app` par l'URL donnée par Vercel.

```
curl https://TON-PROJET.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer cle-projet-1" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Bonjour !"}]}'
```

| Route | Rôle |
|---|---|
| `GET /` | Vérifie que l'API tourne (sans clé) |
| `POST /v1/chat/completions` | Chat compatible OpenAI (`model`: `auto`, `groq`, `groq/<modèle>`, `gemini`, `cloudflare`) |
| `GET /v1/models` | Liste des modèles |
| `GET /groq` | Liste des endpoints Groq |
| `POST /groq/<modèle>` | Un endpoint par modèle Groq (sans fallback) |

SDK OpenAI : `baseURL = https://TON-PROJET.vercel.app/v1`, `apiKey = ta clé projet`.

## Test en local
```
cp .env.example .env     # puis remplis les clés
node local.js            # Node 20.12+
```

## Bon à savoir
- Les pauses après erreur 429 sont gardées en mémoire de chaque instance
  Vercel : elles peuvent être réinitialisées entre deux requêtes. Le fallback
  fonctionne quand même.
- Durée maximale d'une requête : 60 s (`vercel.json`). Selon ton plan Vercel,
  cette limite peut être plus basse : baisse alors `TIMEOUT_MS`.
- Ne mets jamais tes clés dans le code ni dans un site côté navigateur.
