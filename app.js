
(() => {
  "use strict";

  const config = window.JARVIS_CONFIG || {};
  const endpoints = config.endpoints || {};
  const baseUrl = (config.apiBaseUrl || "").replace(/\/+$/, "");
  const statusRoute = endpoints.status;

  const $ = (selector) => document.querySelector(selector);
  const statusText = $("#connectionText");
  const statusDot = $("#connectionDot");
  const refreshButton = $("#refreshButton");

  function setDot(color) {
    statusDot.style.background = color;
    statusDot.style.boxShadow = `0 0 0 3px ${color}33`;
  }

  function setServerCard(value, note) {
    const card = [...document.querySelectorAll(".metric-card")]
      .find((item) => item.querySelector("span")?.textContent.trim() === "Server state");
    if (!card) return;
    card.querySelector("strong").textContent = value;
    card.querySelector("small").textContent = note;
  }

  function showFailure(message) {
    statusText.textContent = message;
    setDot("#ff5265");

    const value = $(".unavailable-value");
    if (value) value.textContent = "API Offline";

    const description = $(".hero-body p");
    if (description) {
      description.textContent =
        "Could not verify EATRADE. Check API Gateway CORS and network access.";
    }

    const action = $(".hero-action-row span:first-child");
    if (action) action.textContent = "API CONNECTION FAILED";

    setServerCard("Offline", "Could not verify API");
  }

  function showStatus(data) {
    if (!data || data.status !== "online") {
      showFailure("EATRADE API responded, but its status is not online");
      return;
    }

    const eaConnected = data.ea_connected === true;

    statusText.textContent = eaConnected
      ? "EATRADE API online · MT5 EA connected"
      : "EATRADE API online · MT5 EA not connected";

    setDot(eaConnected ? "#53d89a" : "#ffb454");

    const value = $(".unavailable-value");
    if (value) value.textContent = "API Online";

    const description = $(".hero-body p");
    if (description) {
      const time = data.timestamp ? new Date(data.timestamp) : null;
      const timeText = time && !Number.isNaN(time.getTime())
        ? ` Last checked ${time.toLocaleTimeString()}.`
        : "";
      description.textContent =
        (data.message || "EATRADE API status verified.") + timeText;
    }

    const action = $(".hero-action-row span:first-child");
    if (action) {
      action.textContent = eaConnected
        ? "API ONLINE · EA CONNECTED"
        : "API ONLINE · EA DISCONNECTED";
    }

    setServerCard(
      "Online",
      eaConnected ? "MT5 EA connected" : "API only; MT5 not linked"
    );
  }

  async function refreshStatus() {
    if (!baseUrl || !statusRoute ||
        statusRoute.path !== "/status" ||
        statusRoute.method !== "POST") {
      showFailure("Verified status endpoint is not configured");
      return;
    }

    refreshButton.disabled = true;
    statusText.textContent = "Checking EATRADE API…";
    setDot("#ffb454");

    try {
      const response = await fetch(baseUrl + statusRoute.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "jarvis-dashboard" }),
        cache: "no-store"
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      showStatus(data);
    } catch (error) {
      showFailure(
        error instanceof TypeError
          ? "Connection failed — check CORS and network access"
          : "API request failed — check endpoint configuration"
      );
    } finally {
      refreshButton.disabled = false;
    }
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.dataset.view === tab.dataset.target);
      });
      document.querySelectorAll(".tab").forEach((item) => {
        item.classList.toggle("active", item === tab);
      });
    });
  });

  $("#localTime").textContent = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());

  $("#routeCount").textContent = Object.keys(endpoints)
    .filter((key) => endpoints[key]?.path).length;

  $("#baseUrlValue").textContent = baseUrl || "Not configured";

  refreshButton.disabled = false;
  refreshButton.addEventListener("click", refreshStatus);
  $("#detailsButton").addEventListener("click", () => {
    $("#detailsDialog").showModal();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  refreshStatus();
})();
