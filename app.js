(() => {
  "use strict";
  const config = window.JARVIS_CONFIG || {};
  const endpoints = config.endpoints && typeof config.endpoints === "object" ? config.endpoints : {};
  const routeCount = Object.keys(endpoints).filter((key) => endpoints[key] && endpoints[key].path).length;
  const $ = (selector) => document.querySelector(selector);
  const views = document.querySelectorAll(".view");
  const tabs = document.querySelectorAll(".tab");
  const statusText = $("#connectionText");
  const baseUrl = typeof config.apiBaseUrl === "string" && config.apiBaseUrl.trim() ? config.apiBaseUrl : "";

  function setActiveView(name) {
    views.forEach((view) => view.classList.toggle("active", view.dataset.view === name));
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.target === name));
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => setActiveView(tab.dataset.target)));
  $("#localTime").textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date());
  $("#routeCount").textContent = String(routeCount);
  $("#baseUrlValue").textContent = baseUrl || "Not configured";

  if (baseUrl && routeCount) {
    statusText.textContent = `${routeCount} configured route${routeCount === 1 ? "" : "s"} — validation required`;
  }

  const dialog = $("#detailsDialog");
  $("#detailsButton").addEventListener("click", () => dialog.showModal());

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
