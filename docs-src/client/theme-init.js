// Appliqué avant le premier affichage : évite le flash de thème. Exécuté tel quel dans <head>.
(function () {
  var theme = "white";
  try {
    var saved = localStorage.getItem("shel-theme");
    theme = saved === "g100" || saved === "white" ? saved : window.matchMedia("(prefers-color-scheme: dark)").matches ? "g100" : "white";
  } catch (e) {
    /* stockage indisponible (iframe sandbox…) : thème clair */
  }
  document.documentElement.setAttribute("data-carbon-theme", theme);
})();
