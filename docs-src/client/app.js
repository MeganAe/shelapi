// Comportement de la page de documentation (sans dépendance, sans framework).
// Principes : tout le texte dynamique est inséré via textContent (jamais innerHTML) ; la clé API n'est
// envoyée qu'à la passerelle elle-même (même origine) et n'est conservée que si l'utilisateur le demande.
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const html = document.documentElement;

  const safeStorage = (area) => ({
    get: (key) => { try { return window[area].getItem(key); } catch { return null; } },
    set: (key, value) => { try { window[area].setItem(key, value); } catch { /* ignoré */ } },
    remove: (key) => { try { window[area].removeItem(key); } catch { /* ignoré */ } },
  });
  const local = safeStorage("localStorage");
  const session = safeStorage("sessionStorage");

  // ------------------------------------------------------------------ Adresse de la passerelle
  // Quand la page est servie par la passerelle, tous les exemples utilisent sa vraie adresse.
  const served = location.protocol === "http:" || location.protocol === "https:";
  const origin = served ? location.origin : "";
  // Dans un cadre isolé (sandbox), window.origin vaut « null » : les requêtes seraient inter-origines et le stockage
  // inaccessible. Le terrain de jeu n'y est donc pas proposé (les exemples gardent l'adresse réelle).
  const live = served && window.origin !== "null";
  html.classList.toggle("is-live", live);
  if (served) $$("[data-base]").forEach((node) => { node.textContent = origin; });

  // ------------------------------------------------------------------ Thème clair / sombre
  const themeButton = $("[data-theme-toggle]");
  const applyTheme = (theme) => {
    html.setAttribute("data-carbon-theme", theme);
    if (!themeButton) return;
    const dark = theme === "g100";
    themeButton.setAttribute("aria-pressed", String(dark));
    themeButton.setAttribute("aria-label", dark ? "Passer au thème clair" : "Passer au thème sombre");
    themeButton.title = dark ? "Thème clair" : "Thème sombre";
  };
  applyTheme(html.getAttribute("data-carbon-theme") === "g100" ? "g100" : "white");
  themeButton?.addEventListener("click", () => {
    const next = html.getAttribute("data-carbon-theme") === "g100" ? "white" : "g100";
    applyTheme(next);
    local.set("shel-theme", next);
  });

  // ------------------------------------------------------------------ Menu latéral (mobile) + suivi de lecture
  const nav = $("#docs-sidenav");
  const navToggle = $("[data-nav-toggle]");
  const overlay = $("[data-overlay]");
  const setNav = (open) => {
    nav?.classList.toggle("is-open", open);
    navToggle?.setAttribute("aria-expanded", String(open));
    navToggle?.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
    if (overlay) overlay.hidden = !open;
  };
  navToggle?.addEventListener("click", () => setNav(!nav.classList.contains("is-open")));
  overlay?.addEventListener("click", () => setNav(false));
  nav?.addEventListener("click", (event) => { if (event.target.closest("a")) setNav(false); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav?.classList.contains("is-open")) { setNav(false); navToggle?.focus(); }
  });

  const navLinks = new Map($$("a[href^='#']", nav ?? document.createElement("div")).map((a) => [a.getAttribute("href").slice(1), a]));
  const targets = [...navLinks.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  const visible = new Set();
  let currentId = "";
  const setCurrent = (id) => {
    if (id === currentId) return;
    currentId = id;
    navLinks.forEach((link, key) => {
      const active = key === id;
      link.classList.toggle("cds--side-nav__link--current", active);
      if (active) link.setAttribute("aria-current", "true"); else link.removeAttribute("aria-current");
      if (active && nav && nav.scrollHeight > nav.clientHeight) link.scrollIntoView({ block: "nearest" });
    });
  };
  if ("IntersectionObserver" in window && targets.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
      const inView = targets.filter((t) => visible.has(t));
      if (inView.length) setCurrent(inView[inView.length - 1].id); // le plus profond / le plus récent
    }, { rootMargin: "-64px 0px -65% 0px" });
    targets.forEach((t) => observer.observe(t));
  }

  // ------------------------------------------------------------------ Copie dans le presse-papiers + info-bulles
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* contexte non sécurisé ou refus : repli ci-dessous */ }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignoré */ }
    area.remove();
    return ok;
  }

  const announcer = document.createElement("div");
  announcer.className = "cds--visually-hidden";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");
  document.body.append(announcer);

  $$("[data-tooltip]").forEach((tip) => {
    const open = () => tip.classList.add("cds--popover--open");
    const close = () => { if (!tip.querySelector(".is-copied")) tip.classList.remove("cds--popover--open"); };
    tip.addEventListener("mouseenter", open);
    tip.addEventListener("mouseleave", close);
    tip.addEventListener("focusin", open);
    tip.addEventListener("focusout", close);
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    const inline = event.target.closest("[data-copy-inline]");
    if (!button && !inline) return;

    if (button) {
      const code = button.closest(".docs-snippet")?.querySelector("code");
      if (!code || !(await copyText(code.textContent))) return;
      const tip = button.closest("[data-tooltip]");
      const label = tip?.querySelector("[data-tooltip-text]");
      button.classList.add("is-copied");
      if (label) label.textContent = "Copié !";
      tip?.classList.add("cds--popover--open");
      announcer.textContent = "Code copié dans le presse-papiers";
      setTimeout(() => {
        button.classList.remove("is-copied");
        if (label) label.textContent = label.dataset.label;
        if (!tip?.matches(":hover, :focus-within")) tip?.classList.remove("cds--popover--open");
        announcer.textContent = "";
      }, 1800);
    } else if (await copyText(inline.textContent)) {
      const previous = inline.title;
      inline.title = "Copié !";
      announcer.textContent = "Copié dans le presse-papiers";
      setTimeout(() => { inline.title = previous; announcer.textContent = ""; }, 1800);
    }
  });

  // ------------------------------------------------------------------ Onglets (langage mémorisé et synchronisé)
  $$("[data-tabs]").forEach((root) => {
    const tabs = $$("[role='tab']", root);
    const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
    const group = root.dataset.group;

    const select = (tab, { focus = false, propagate = true } = {}) => {
      tabs.forEach((t, i) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        t.classList.toggle("cds--tabs__nav-item--selected", on);
        panels[i].hidden = !on;
      });
      if (focus) tab.focus();
      if (group && propagate && tab.dataset.key) {
        local.set(`shel-${group}`, tab.dataset.key);
        $$(`[data-tabs][data-group="${group}"]`).forEach((other) => { if (other !== root) other.selectKey(tab.dataset.key); });
      }
    };
    root.selectKey = (key) => {
      const match = tabs.find((t) => t.dataset.key === key);
      if (match) select(match, { propagate: false });
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (event) => {
        const last = tabs.length - 1;
        const target = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        select(tabs[target], { focus: true });
      });
    });
  });
  $$("[data-tabs][data-group]").forEach((root) => {
    const saved = local.get(`shel-${root.dataset.group}`);
    if (saved) root.selectKey(saved);
  });

  // ------------------------------------------------------------------ Accordéons
  $$("[data-accordion] .cds--accordion__heading").forEach((heading) => {
    heading.addEventListener("click", () => {
      const item = heading.closest(".cds--accordion__item");
      const open = item.classList.toggle("cds--accordion__item--active");
      heading.setAttribute("aria-expanded", String(open));
    });
  });

  // ------------------------------------------------------------------ Interrupteurs (toggle)
  $$("[data-toggle]").forEach((toggle) => {
    const text = toggle.parentElement.querySelector(".cds--toggle__text");
    toggle.addEventListener("click", () => {
      const on = toggle.getAttribute("aria-checked") !== "true";
      toggle.setAttribute("aria-checked", String(on));
      if (text) text.textContent = on ? toggle.dataset.on : toggle.dataset.off;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  // ------------------------------------------------------------------ Terrain de jeu
  const form = $("#pg-form");
  if (form && live) initPlayground(form);

  function initPlayground(root) {
    const field = (id) => $(`#${id}`, root);
    const keyInput = field("pg-key");
    const remember = field("pg-remember");
    const modelSelect = field("pg-model");
    const loadModels = field("pg-load-models");
    const modelsStatus = field("pg-models-status");
    const system = field("pg-system");
    const user = field("pg-user");
    const streamToggle = field("pg-stream");
    const temperature = field("pg-temperature");
    const maxTokens = field("pg-max-tokens");
    const sendButton = field("pg-send");
    const stopButton = field("pg-stop");
    const meta = field("pg-meta");
    const output = field("pg-output");
    const raw = field("pg-raw");
    const curlCode = field("pg-curl-code");

    let controller = null;
    const isOn = (toggle) => toggle.getAttribute("aria-checked") === "true";

    // --- Clé : mémoire de l'onglet seulement si l'utilisateur coche « mémoriser »
    const savedKey = session.get("shel-key");
    if (savedKey) {
      keyInput.value = savedKey;
      remember.setAttribute("aria-checked", "true");
      remember.parentElement.querySelector(".cds--toggle__text").textContent = remember.dataset.on;
    }
    const persistKey = () => (isOn(remember) && keyInput.value ? session.set("shel-key", keyInput.value) : session.remove("shel-key"));
    keyInput.addEventListener("input", persistKey);
    remember.addEventListener("change", persistKey);

    // --- Corps de la requête et commande curl équivalente
    function buildBody() {
      const messages = [];
      if (system.value.trim()) messages.push({ role: "system", content: system.value.trim() });
      messages.push({ role: "user", content: user.value });
      const body = { model: modelSelect.value || "auto", messages };
      if (isOn(streamToggle)) body.stream = true;
      const t = temperature.value.trim();
      if (t !== "" && Number.isFinite(Number(t))) body.temperature = Number(t);
      const m = maxTokens.value.trim();
      if (m !== "" && Number.isInteger(Number(m)) && Number(m) > 0) body.max_tokens = Number(m);
      return body;
    }

    function renderCurl() {
      const json = JSON.stringify(buildBody(), null, 2).replaceAll("'", "'\\''");
      curlCode.textContent = [
        `curl ${isOn(streamToggle) ? "-N " : ""}${origin}/v1/chat/completions`,
        '  -H "Authorization: Bearer $GATEWAY_KEY"',
        '  -H "Content-Type: application/json"',
        `  -d '${json}'`,
      ].join(" \\\n");
    }
    root.addEventListener("input", renderCurl);
    root.addEventListener("change", renderCurl);
    renderCurl();

    // --- Affichage
    const tagNode = (text, kind) => {
      const tag = document.createElement("span");
      tag.className = `cds--tag cds--tag--${kind}`;
      const label = document.createElement("span");
      label.className = "cds--tag__label";
      label.textContent = text;
      tag.append(label);
      return tag;
    };
    const showMeta = (items) => meta.replaceChildren(...items);
    const setOutput = (text, { mono = false, empty = false } = {}) => {
      output.textContent = text;
      output.classList.toggle("is-mono", mono);
      output.classList.toggle("is-empty", empty);
    };
    const statusKind = (status) => (status < 300 ? "green" : status < 500 ? "red" : "magenta");

    function describeError(text) {
      try {
        const { error } = JSON.parse(text);
        if (error?.message) {
          const lines = [`${error.code ?? "erreur"} : ${error.message}`];
          if (error.param) lines.push(`Champ concerné : ${error.param}`);
          for (const d of error.details ?? []) lines.push(`- ${d.provider}/${d.model} : ${d.kind}${d.status ? ` (HTTP ${d.status})` : ""}${d.message ? ` — ${d.message}` : ""}`);
          if (error.request_id) lines.push(`Identifiant de requête : ${error.request_id}`);
          return lines.join("\n");
        }
      } catch { /* pas du JSON */ }
      return text || "Réponse vide.";
    }

    function setBusy(busy) {
      sendButton.disabled = busy;
      stopButton.hidden = !busy;
      root.setAttribute("aria-busy", String(busy));
    }

    // --- Chargement de la liste des modèles
    loadModels.addEventListener("click", async () => {
      const key = keyInput.value.trim();
      modelsStatus.classList.remove("is-error");
      if (!key) {
        modelsStatus.textContent = "Saisissez d'abord votre clé API.";
        modelsStatus.classList.add("is-error");
        keyInput.focus();
        return;
      }
      modelsStatus.textContent = "Chargement…";
      try {
        const response = await fetch("/v1/models", { headers: { Authorization: `Bearer ${key}` } });
        const text = await response.text();
        if (!response.ok) throw new Error(describeError(text).split("\n")[0]);
        const ids = (JSON.parse(text).data ?? []).map((m) => m.id);
        const previous = modelSelect.value;
        modelSelect.replaceChildren(...ids.map((id) => new Option(id === "auto" ? "auto (bascule automatique)" : id, id)));
        if (ids.includes(previous)) modelSelect.value = previous;
        modelsStatus.textContent = `${ids.length} modèles disponibles.`;
        renderCurl();
      } catch (error) {
        modelsStatus.textContent = error.message || "Impossible de charger les modèles.";
        modelsStatus.classList.add("is-error");
      }
    });

    // --- Lecture d'un flux SSE
    async function readStream(response, startedAt) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let first = true;
      const events = [];
      setOutput("", {});

      const handle = (part) => {
        if (!part.trim()) return;
        events.push(part);
        raw.textContent = events.join("\n\n");
        const data = part.replace(/^data: ?/, "");
        if (data === "[DONE]") return;
        let chunk;
        try { chunk = JSON.parse(data); } catch { return; }
        if (chunk.error) {
          text += `${text ? "\n\n" : ""}Flux interrompu — ${chunk.error.code ?? "erreur"} : ${chunk.error.message}`;
        } else {
          const piece = chunk.choices?.[0]?.delta?.content ?? "";
          if (piece && first) { first = false; meta.append(tagNode(`1er jeton : ${Math.round(performance.now() - startedAt)} ms`, "cool-gray")); }
          text += piece;
        }
        setOutput(text, {});
        output.scrollTop = output.scrollHeight;
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/); // « \n\n » ou « \r\n\r\n » selon le fournisseur
        buffer = parts.pop();
        parts.forEach(handle);
      }
      handle(buffer + decoder.decode()); // dernier événement, s'il n'était pas suivi d'une ligne vide
      if (!text) setOutput("(flux vide)", { empty: true });
    }

    // --- Envoi
    root.addEventListener("submit", async (event) => {
      event.preventDefault();
      const key = keyInput.value.trim();
      if (!key) {
        setOutput("Saisissez votre clé API pour envoyer une requête.", { empty: true });
        keyInput.focus();
        return;
      }
      if (!user.value.trim()) {
        setOutput("Écrivez un message à envoyer.", { empty: true });
        user.focus();
        return;
      }
      const body = buildBody();
      controller = new AbortController();
      setBusy(true);
      showMeta([]);
      raw.textContent = "";
      setOutput("En attente de la réponse…", { empty: true });
      const startedAt = performance.now();
      try {
        const response = await fetch("/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const items = [tagNode(`HTTP ${response.status}`, statusKind(response.status))];
        for (const [label, header] of [["Fournisseur", "x-provider"], ["Modèle", "x-model"]]) {
          const value = response.headers.get(header);
          if (value) items.push(tagNode(`${label} : ${value}`, "blue"));
        }
        const requestId = response.headers.get("x-request-id");
        if (requestId) items.push(tagNode(requestId, "gray"));
        showMeta(items);

        if (!response.ok) {
          const text = await response.text();
          raw.textContent = text;
          setOutput(describeError(text), { mono: true });
          const retry = response.headers.get("retry-after");
          if (retry) meta.append(tagNode(`Réessayer dans ${retry} s`, "purple"));
        } else if (body.stream) {
          await readStream(response, startedAt);
          meta.append(tagNode(`Terminé en ${Math.round(performance.now() - startedAt)} ms`, "cool-gray"));
        } else {
          const data = await response.json();
          raw.textContent = JSON.stringify(data, null, 2);
          setOutput(data.choices?.[0]?.message?.content ?? "(réponse sans texte)", {});
          meta.append(tagNode(`${Math.round(performance.now() - startedAt)} ms`, "cool-gray"));
          if (data.usage?.total_tokens) meta.append(tagNode(`${data.usage.total_tokens} jetons`, "cool-gray"));
        }
      } catch (error) {
        if (error.name === "AbortError") {
          output.textContent += `${output.classList.contains("is-empty") ? "" : "\n\n"}[Interrompu]`;
          output.classList.remove("is-empty");
        } else {
          setOutput(`Impossible de joindre la passerelle : ${error.message}`, { mono: true });
        }
      } finally {
        setBusy(false);
        controller = null;
      }
    });
    stopButton.addEventListener("click", () => controller?.abort());
  }
})();
