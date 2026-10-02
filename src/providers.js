// =====================================================================
//  Fournisseurs : liste des modèles, pauses temporaires, choix de la chaîne
//  de secours à partir du champ « model » de la requête.
// =====================================================================

// Modèles Groq qui ne font pas de chat (audio, modération, embeddings…)
const NON_CHAT = /whisper|tts|orpheus|guard|embed|moderation|transcri|speech/i;

// Taille annoncée dans l'identifiant d'un modèle (« …-120b » → 120, « allam-2-7b » → 7) ; 0 si elle n'y figure pas.
const sizeInBillions = (id) => {
  const found = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(id);
  return found ? Number(found[1]) : 0;
};
// Du plus grand au plus petit, puis par ordre alphabétique. L'ordre de la liste renvoyée par Groq, lui, n'est pas
// stable (il s'est inversé en une heure sur un déploiement réel) : on ne s'y fie pas pour choisir qui répond d'abord.
const biggestFirst = (a, b) => sizeInBillions(b) - sizeInBillions(a) || (a < b ? -1 : a > b ? 1 : 0);

const MODELS_TTL_MS = 3_600_000; // la liste Groq est gardée 1 h
const MODELS_RETRY_MS = 60_000; // si la liste est indisponible, on réessaie dans 1 min (pas à chaque requête)

/** Pauses : un modèle en pause est ignoré tant qu'il existe une alternative. */
export function createCooldowns(now = Date.now) {
  const map = new Map(); // "fournisseur/modèle" -> { until, reason }
  return {
    set(key, ms, reason) {
      map.set(key, { until: now() + ms, reason });
    },
    /** Millisecondes restantes (0 si le modèle n'est pas en pause). */
    remaining(key) {
      const entry = map.get(key);
      if (!entry) return 0;
      const left = entry.until - now();
      if (left <= 0) {
        map.delete(key);
        return 0;
      }
      return left;
    },
    clear: () => map.clear(),
  };
}

export function createProviders({ config, fetch, now = Date.now, log }) {
  const cooldowns = createCooldowns(now);
  const enabled = () => config.providers.filter((p) => p.enabled);
  const byName = (name) => config.providers.find((p) => p.name === name);

  // --- Liste des modèles Groq (cache + une seule requête à la fois) ---
  let cache = { at: -Infinity, ttl: 0, ids: [] };
  let inflight = null;

  async function fetchGroqModels(groq) {
    const r = await fetch(`${groq.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${groq.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { data } = await r.json();
    if (!Array.isArray(data)) throw new Error("réponse inattendue");
    const active = [...new Set(data.filter((m) => m && typeof m.id === "string" && m.active !== false && !NON_CHAT.test(m.id)).map((m) => m.id))];
    // Modèles préférés (GROQ_MODEL) d'abord, dans l'ordre demandé ; les autres suivent, du plus grand au plus petit.
    const preferred = [...new Set(groq.models)].filter((id) => active.includes(id));
    return [...preferred, ...active.filter((id) => !preferred.includes(id)).sort(biggestFirst)];
  }

  async function groqModels() {
    const groq = byName("groq");
    if (cache.ids.length && now() - cache.at < cache.ttl) return cache.ids;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const ids = await fetchGroqModels(groq);
        if (!ids.length) throw new Error("aucun modèle de chat actif");
        cache = { at: now(), ttl: MODELS_TTL_MS, ids };
        const missing = groq.models.filter((id) => !ids.includes(id));
        if (missing.length) {
          log.warn(`[groq] GROQ_MODEL cite des modèles absents des modèles de chat actifs de Groq (retirés, désactivés ou mal orthographiés) : ${missing.join(", ")}. Ils sont ignorés : mettez GROQ_MODEL à jour.`);
        }
        log.info(`[groq] ${ids.length} modèles chargés : ${ids.join(", ")}`);
        return ids;
      } catch (e) {
        log.warn(`[groq] liste des modèles indisponible (${e.message}) : repli sur ${cache.ids.length ? "la dernière liste connue" : "GROQ_MODEL"}`);
        const ids = cache.ids.length ? cache.ids : [...groq.models];
        cache = { at: now(), ttl: MODELS_RETRY_MS, ids };
        return ids;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /** Tous les modèles d'un fournisseur sous la forme [{ provider, model }]. */
  async function expand(provider) {
    const models = provider.discover ? await groqModels() : provider.models;
    return models.map((model) => ({ provider, model }));
  }

  /**
   * Transforme le champ « model » en chaîne d'essais.
   *   "auto" / absent / inconnu  → tous les fournisseurs actifs, dans l'ordre
   *   "groq"                     → tous les modèles Groq
   *   "groq/openai/gpt-oss-120b" → ce modèle uniquement (forced = true : pas de secours)
   */
  async function resolveChain(model) {
    const active = enabled();
    const auto = async () => ({ chain: (await Promise.all(active.map(expand))).flat(), forced: false });
    if (typeof model !== "string" || !model || model === "auto") return auto();

    const [name, ...rest] = model.split("/");
    const provider = active.find((p) => p.name === name);
    if (!provider) return auto();

    const exact = rest.join("/");
    if (exact) return { chain: [{ provider, model: exact }], forced: true };
    return { chain: await expand(provider), forced: false };
  }

  return { enabled, byName, groqModels, expand, resolveChain, cooldowns };
}
