# Générateur de la documentation

Ce dossier produit `public/docs/index.html`, la page de documentation servie sur `/docs/`
(interface [Carbon Design System](https://carbondesignsystem.com), polices IBM Plex).

La page est **versionnée dans Git** : le déploiement n'exécute aucune étape de build.
Il suffit de la régénérer quand l'API ou la documentation change.

```bash
npm run docs:install   # une seule fois : installe sass, @carbon/styles, highlight.js et les polices (dans docs-src/node_modules)
npm run docs:build     # régénère public/docs/index.html
npm test               # vérifie que la page correspond bien à l'API (tests/docs.test.js)
```

## D'où viennent les contenus ?

| Contenu | Source |
| --- | --- |
| Routes, paramètres, schémas, exemples de requêtes et de réponses | `src/openapi.js` (aussi servi sur `/openapi.json`) |
| Codes d'erreur et messages | `src/http.js` (`ERRORS`) |
| Valeurs par défaut, durées de pause | `src/config.js`, `src/chat.js` |
| Exemples de code (curl, JavaScript, Python, SDK OpenAI) | générés par `lib/samples.mjs` à partir de la spécification |
| Textes explicatifs (en français) | `content.mjs` |
| Mise en page | `styles/main.scss` (Carbon + styles propres à la page) |
| Comportement (thème, onglets, copie, terrain de jeu) | `client/app.js` |

`tests/docs.test.js` échoue si l'API change sans que la page soit régénérée, si une ressource externe
apparaît, ou si la politique de sécurité (CSP) ne correspond plus aux scripts intégrés.

## Notes

- La page est **autonome** : CSS, polices, icônes et scripts sont intégrés au fichier HTML. Une politique CSP
  (balise `<meta>`) n'autorise que ces scripts et ce style, identifiés par leur empreinte SHA-256.
- Les icônes (`icons/`) viennent de [@carbon/icons](https://github.com/carbon-design-system/carbon/tree/main/packages/icons) (Apache-2.0).
- Aperçu avec de faux fournisseurs, sans aucune clé : `npm run preview`, puis <http://localhost:3000/docs/>.
