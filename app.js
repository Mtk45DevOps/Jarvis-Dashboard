(() => {
  "use strict";

  const config = window.JARVIS_CONFIG || {};
  const endpoints = config.endpoints || {};
  const baseUrl = (config.apiBaseUrl || "").replace(/\/+$/, "");
  const statusRoute = endpoints.status;
  const HEARTBEAT_STALE_MS = 90_000;
  const REFRESH_INTERVAL_MS = 15_000;

  const $ = (selector) => document.querySelector(selector);
  const statusText = $("#connectionText");
  const statusDot = $("#connectionDot");
  const refreshButton = $("#refreshButton");
  let requestInFlight = false;
  let lastTelemetry = null;

  function setDot(color) {
    statusDot.style.background = color;
    statusDot.style.boxShadow = `0 0 0 3px ${color}33`;
  }

  function setText(selector, value) {
    const element = $(selector);
    if (element) element.textContent = value;
  }

  function numberText(value) {
    const number = Number(value);
    return value !== null && value !== "" && Number.isFinite(number)
      ? number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  }

  function countText(value) {
    const number = Number(value);
    if (value === null || value === "" || !Number.isFinite(number)) return "—";
    return Number.isInteger(number) ? String(number) : number.toFixed(1);
  }

  function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function heartbeatIsFresh(data) {
    const lastSeen = validDate(data.last_seen);
    if (!lastSeen) return false;
    const age = Date.now() - lastSeen.getTime();
    return age >= -30_000 && age <= HEARTBEAT_STALE_MS;
  }

  function formatDateTime(value) {
    const date = validDate(value);
    return date ? date.toLocaleString() : "—";
  }

  function setServerCard(value, note) {
    setText("#serverStateValue", value);
    setText("#serverStateNote", note);
  }

  function showFailure(message) {
    statusText.textContent = message;
    setDot("#ff5265");
    setText("#telemetryState", "API OFFLINE");
    setText(".unavailable-value", "API Offline");
    setText(".hero-action-row span:first-child", "API CONNECTION FAILED");
    setServerCard("Offline", "Could not verify API");
    renderSignals([]);
    setText("#heartbeatHeadline", "Could not refresh EATRADE status");
    setText("#heartbeatNote", "Previously received metrics, if any, are retained until a new response is available.");
  }


  let signalMarketFilter = "all";

  function classifySignalMarket(signal) {
    const symbol = String(signal.symbol || "").toUpperCase();
    const market = String(signal.market || "").toLowerCase();
    if (market.includes("synthetic") || /^(VOLATILITY|BOOM|CRASH|STEP|JUMP|RANGE|DRIFT|DEX|SKEW|1HZ)/.test(symbol)) return "synthetics";
    if (market === "gold" || /^(XAU|GOLD)/.test(symbol)) return "gold";
    if (market === "forex" || /^[A-Z]{6}([.][A-Z0-9]+)?$/.test(symbol)) return "forex";
    return "other";
  }

  function renderSignals(signals) {
    const host = $("#signalCards");
    if (!host) return;
    const validSignals = Array.isArray(signals) ? signals.filter((item) =>
      item && typeof item === "object" &&
      typeof item.symbol === "string" &&
      ["BUY", "SELL"].includes(String(item.direction || item.side || "").toUpperCase())
    ) : [];
    const filtered = validSignals.filter((item) =>
      signalMarketFilter === "all" || classifySignalMarket(item) === signalMarketFilter
    );
    setText("#signalCount", filtered.length + " SIGNAL" + (filtered.length === 1 ? "" : "S"));
    setText("#signalFeedState", validSignals.length ? "LIVE SIGNAL DATA" : "WAITING FOR EA");
    host.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const mark = document.createElement("span");
      mark.className = "empty-symbol";
      mark.textContent = "⌁";
      const heading = document.createElement("h3");
      heading.textContent = validSignals.length ? "No signals in this filter" : "Signal feed not connected";
      const paragraph = document.createElement("p");
      paragraph.textContent = validSignals.length
        ? "Try another market filter to view the strategy's published setups."
        : "The current API response contains no strategy signals. No sample or invented signals are shown.";
      empty.append(mark, heading, paragraph);
      host.append(empty);
      return;
    }

    filtered.slice(0, 50).forEach((signal) => {
      const direction = String(signal.direction || signal.side).toUpperCase();
      const card = document.createElement("article");
      card.className = "signal-card";
      const top = document.createElement("div");
      top.className = "signal-card-top";
      const symbol = document.createElement("strong");
      symbol.textContent = signal.symbol;
      const side = document.createElement("span");
      side.className = direction === "BUY" ? "signal-side buy" : "signal-side sell";
      side.textContent = direction;
      top.append(symbol, side);
      const tf = document.createElement("p");
      tf.className = "signal-timeframe";
      tf.textContent = (signal.timeframe || signal.entry_timeframe || "Timeframe unavailable") + " · " + (signal.strategy || "JARVIS strategy");
      const grid = document.createElement("div");
      grid.className = "signal-level-grid";
      [["Entry", signal.entry], ["Stop loss", signal.sl !== undefined ? signal.sl : signal.stop_loss], ["Take profit", signal.tp !== undefined ? signal.tp : signal.take_profit]].forEach((pair) => {
        const cell = document.createElement("div");
        const caption = document.createElement("span");
        caption.textContent = pair[0];
        const price = document.createElement("strong");
        price.textContent = pair[1] === undefined || pair[1] === null || pair[1] === "" ? "—" : String(pair[1]);
        cell.append(caption, price);
        grid.append(cell);
      });
      const foot = document.createElement("div");
      foot.className = "signal-card-foot";
      const status = document.createElement("span");
      status.textContent = String(signal.status || "CONFIRMED").toUpperCase();
      const time = document.createElement("time");
      time.textContent = formatDateTime(signal.timestamp || signal.time || signal.created_at);
      foot.append(status, time);
      card.append(top, tf, grid, foot);
      host.append(card);
    });
  }

  document.querySelectorAll("[data-signal-market]").forEach((button) => {
    button.addEventListener("click", () => {
      signalMarketFilter = button.dataset.signalMarket || "all";
      document.querySelectorAll("[data-signal-market]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      renderSignals(lastTelemetry && Array.isArray(lastTelemetry.signals) ? lastTelemetry.signals : []);
    });
  });

  function showStatus(data) {
    if (!data || data.status !== "online") {
      showFailure("EATRADE API responded, but its status is not online");
      return;
    }

    lastTelemetry = data;
    const heartbeatFresh = heartbeatIsFresh(data);
    const eaConnected = data.ea_connected === true && heartbeatFresh;
    const apiTimestamp = validDate(data.timestamp);

    statusText.textContent = eaConnected
      ? "EATRADE API online · MT5 EA connected"
      : heartbeatFresh
        ? "EATRADE API online · MT5 EA not connected"
        : "EATRADE API online · MT5 heartbeat stale";
    setDot(eaConnected ? "#53d89a" : "#ffb454");

    setText(".unavailable-value", eaConnected ? "Live Monitoring" : "Heartbeat Stale");
    setText(".hero-body p", (data.message || "EATRADE API status verified.") +
      (apiTimestamp ? ` Last checked ${apiTimestamp.toLocaleTimeString()}.` : ""));
    setText(".hero-action-row span:first-child", eaConnected
      ? "API ONLINE · EA CONNECTED"
      : "API ONLINE · CHECK HEARTBEAT");

    setText("#openPositionsValue", countText(data.open_positions));
    setText("#equityValue", numberText(data.equity));
    setText("#balanceValue", numberText(data.balance));
    setText("#symbolValue", data.symbol || "—");
    setText("#timeframeValue", typeof data.timeframe === "string"
      ? data.timeframe.replace(/^PERIOD_/, "")
      : "—");
    setText("#lastSeenValue", formatDateTime(data.last_seen));
    setText("#dayPlValue", "—");
    setText("#dayPlNote", "Not provided by API");

    if (eaConnected) {
      setText("#telemetryState", "CONNECTED");
      setServerCard("Online", "Fresh MT5 heartbeat");
      setText("#heartbeatHeadline", "MT5 heartbeat is recent");
      setText("#heartbeatNote", `Latest heartbeat: ${formatDateTime(data.last_seen)}. Values shown are supplied by the EATRADE API.`);
    } else {
      setText("#telemetryState", heartbeatFresh ? "EA DISCONNECTED" : "HEARTBEAT STALE");
      setServerCard("Online", heartbeatFresh ? "API online; EA not linked" : "No recent MT5 heartbeat");
      setText("#heartbeatHeadline", heartbeatFresh ? "API online, EA not connected" : "MT5 heartbeat is stale");
      setText("#heartbeatNote", heartbeatFresh
        ? "The API is responding, but it does not confirm an active EA heartbeat."
        : `No fresh EA heartbeat within ${HEARTBEAT_STALE_MS / 1000} seconds. Check MT5 and the heartbeat EA.`);
    }

    // Display only genuine signal records returned by the API; never invent demo signals.
    renderSignals(Array.isArray(data.signals) ? data.signals : []);
    // This endpoint does not provide individual position details or daily P/L.
    setText("#positionsCount", "COUNT ONLY");
  }

  async function refreshStatus() {
    if (requestInFlight || document.hidden) return;

    if (!baseUrl || !statusRoute ||
        statusRoute.path !== "/status" ||
        statusRoute.method !== "POST") {
      showFailure("Verified status endpoint is not configured");
      return;
    }

    requestInFlight = true;
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      showStatus(data);
    } catch (error) {
      showFailure(error instanceof TypeError
        ? "Connection failed — check CORS and network access"
        : "API request failed — check endpoint configuration");
    } finally {
      requestInFlight = false;
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

  function updateLocalTime() {
    setText("#localTime", new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date()));
  }
  updateLocalTime();
  window.setInterval(updateLocalTime, 30_000);

  setText("#routeCount", Object.keys(endpoints).filter((key) => endpoints[key]?.path).length);
  setText("#baseUrlValue", baseUrl || "Not configured");

  refreshButton.disabled = false;
  refreshButton.addEventListener("click", refreshStatus);
  $("#detailsButton").addEventListener("click", () => $("#detailsDialog").showModal());

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshStatus();
  });
  window.setInterval(() => {
    if (!document.hidden) refreshStatus();
  }, REFRESH_INTERVAL_MS);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  refreshStatus();
})();