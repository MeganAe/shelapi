// =====================================================================
//  Point d'entrée Vercel (fonction serverless).
//  Toute la logique est dans src/ ; voir src/handler.js pour la liste des routes.
// =====================================================================
import { createHandler } from "../src/handler.js";

// En local, charge le fichier .env s'il existe (Node 20.12+). Sur Vercel, ce sont les variables du projet.
try {
  process.loadEnvFile();
} catch {
  /* pas de .env : on utilise l'environnement tel quel */
}

export default createHandler();
