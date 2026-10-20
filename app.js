(() => {
  "use strict";

  const config = window.LEX_CONFIG || {};
  const endpoints = config.endpoints || {};
  const baseUrl = (config.apiBaseUrl || "").replace(/\/+$/, "");
  const statusRoute = endpoints.status;
  const HEARTBEAT_STALE_MS = 90_000;
  const REFRESH_INTERVAL_MS = 5_000;

  const PUSH_API_URL =
    "https://tzk9f9aeqi.execute-api.eu-west-2.amazonaws.com/push";

  const VAPID_PUBLIC_KEY =
    "BPqOmYfHxGySB_LekEh4tOTsNR5apu8WryZEc-UFj44dqE4158A9VLlvFN4Uti0AMsX_O_54hd1zn1Doe907aoo";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      output[i] = raw.charCodeAt(i);
    }

    return output;
  }

  const $ = (selector) => document.querySelector(selector);
  const statusText = $("#connectionText");
  const statusDot = $("#connectionDot");
  const refreshButton = $("#refreshButton");
  let requestInFlight = false;
  let lastTelemetry = null;
  let tradeBaselineReady = false;
  let knownTradeIds = new Set();
  const MAX_KNOWN_TRADE_IDS = 500;

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
    setDot("#777777");
    setText("#telemetryState", "API OFFLINE");
    setText(".unavailable-value", "API Offline");
    setText(".hero-action-row span:first-child", "API CONNECTION FAILED");
    setServerCard("Offline", "Could not verify API");
    renderSignals(lastTelemetry && Array.isArray(lastTelemetry.signals) ? lastTelemetry.signals : []);
    renderEATrades(lastTelemetry || {});
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
      tf.textContent = (signal.timeframe || signal.entry_timeframe || "Timeframe unavailable") + " · " + (signal.strategy || "LEX strategy");
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

  function tradeIdentity(trade) {
    const id = trade && (trade.ticket ?? trade.position_id ?? trade.id);
    return id === undefined || id === null || String(id).trim() === ""
      ? null
      : String(id);
  }

  function showTradeToast(trade) {
    const symbol = String(trade.symbol || "Unknown symbol");
    const side = String(trade.direction || trade.side || trade.type || "POSITION").toUpperCase();
    const ticket = tradeIdentity(trade);
    const message = "New MT5 trade detected: " + side + " " + symbol +
      (ticket ? " · Ticket " + ticket : "");
    let toast = $("#tradeNotificationToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "tradeNotificationToast";
      toast.className = "trade-notification-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 6500);

    if ("Notification" in window && Notification.permission === "granted") {
      const options = { body: message, tag: "lex-trade-" + (ticket || symbol + side), icon: "./icons/lex-dragon.svg" };
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready
          .then((registration) => registration.showNotification("LEX · New trade", options))
          .catch(() => {});
      } else {
        try { new Notification("LEX · New trade", options); } catch (_) {}
      }
    }
  }

  function checkForNewTrades(data) {
    const freshHeartbeat = data.ea_connected === true && heartbeatIsFresh(data);
    const snapshotFresh = data.positions_snapshot_recent === true;
    const trades = Array.isArray(data.open_trades) ? data.open_trades
      : Array.isArray(data.positions) ? data.positions
      : Array.isArray(data.trades) ? data.trades
      : null;

    // Never notify from stale position snapshots or when the MT5 EA is disconnected.
    if (!freshHeartbeat || !snapshotFresh || trades === null) {
      tradeBaselineReady = false;
      knownTradeIds = new Set();
      return;
    }

    const currentIds = new Set();
    const newTrades = [];
    trades.forEach((trade) => {
      const id = tradeIdentity(trade);
      if (!id) return;
      currentIds.add(id);
      if (tradeBaselineReady && !knownTradeIds.has(id)) newTrades.push(trade);
    });

    // First fresh snapshot establishes a baseline; it must not alert for old open positions.
    if (tradeBaselineReady) newTrades.forEach(showTradeToast);
    tradeBaselineReady = true;
    knownTradeIds = currentIds;
    if (knownTradeIds.size > MAX_KNOWN_TRADE_IDS) {
      knownTradeIds = new Set(Array.from(knownTradeIds).slice(-MAX_KNOWN_TRADE_IDS));
    }
  }

  async function setupNotifications() {
    const button = $("#enableNotificationsButton");
    if (!button) return;

    if (!("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)) {
      button.textContent = "Push notifications unsupported";
      button.disabled = true;
      return;
    }

    if (Notification.permission === "denied") {
      button.textContent = "Notifications blocked in browser";
      button.disabled = true;
      return;
    }

    button.textContent = "Enable trade notifications";
    button.disabled = false;

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Connecting notifications…";

      try {
        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
          button.textContent = "Notification permission not granted";
          button.disabled = permission === "denied";
          return;
        }

        const registration = await navigator.serviceWorker.ready;

        let subscription =
          await registration.pushManager.getSubscription();

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey:
              urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

        const response = await fetch(PUSH_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "subscribe",
            subscription: subscription.toJSON()
          })
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(
            result.error || `Subscription failed: HTTP ${response.status}`
          );
        }

        button.textContent = "Push notifications connected";

        await registration.showNotification(
          "LEX · Notifications connected",
          {
            body: "This browser is registered for LEX push alerts.",
            tag: "lex-push-connected",
            icon: "./icons/lex-dragon.svg"
          }
        );
      } catch (error) {
        console.error("LEX push setup failed:", error);
        button.textContent = "Push setup failed — retry";
        button.disabled = false;
      }
    });
  }

  function renderEATrades(data) {
    const host = $("#eaTradeCards");
    if (!host) return;

    // Support only trade arrays actually returned by the status API.
    const trades = Array.isArray(data?.open_trades) ? data.open_trades
      : Array.isArray(data?.positions) ? data.positions
      : Array.isArray(data?.trades) ? data.trades
      : null;

    host.replaceChildren();
    if (trades === null) {
      setText("#eaTradesCount", data && Number.isFinite(Number(data.open_positions))
        ? countText(data.open_positions) + " OPEN"
        : "UNAVAILABLE");
      setText("#tradesFeedState", "DETAILS UNAVAILABLE");
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const mark = document.createElement("span");
      mark.className = "empty-symbol";
      mark.textContent = "◫";
      const heading = document.createElement("h3");
      heading.textContent = "Individual trade details unavailable";
      const paragraph = document.createElement("p");
      paragraph.textContent = data && data.open_positions !== undefined
        ? "The API reports an open-position count, but does not return individual position records yet. Add a verified positions array to the status response to display each EA trade."
        : "The current API response contains no individual EA trade records. No sample trades are shown.";
      empty.append(mark, heading, paragraph);
      host.append(empty);
      return;
    }

    setText("#eaTradesCount", trades.length + " OPEN");
    setText("#tradesFeedState", "LIVE TRADE DATA");
    if (!trades.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const mark = document.createElement("span");
      mark.className = "empty-symbol";
      mark.textContent = "◫";
      const heading = document.createElement("h3");
      heading.textContent = "No open EA trades";
      const paragraph = document.createElement("p");
      paragraph.textContent = "The API returned an empty open-trades list.";
      empty.append(mark, heading, paragraph);
      host.append(empty);
      return;
    }

    trades.slice(0, 100).forEach((trade) => {
      if (!trade || typeof trade !== "object") return;
      const card = document.createElement("article");
      card.className = "signal-card";
      const top = document.createElement("div");
      top.className = "signal-card-top";
      const symbol = document.createElement("strong");
      symbol.textContent = String(trade.symbol || "Unknown symbol");
      const sideText = String(trade.direction || trade.side || trade.type || "POSITION").toUpperCase();
      const side = document.createElement("span");
      side.className = "signal-side " + (sideText.includes("BUY") ? "buy" : sideText.includes("SELL") ? "sell" : "");
      side.textContent = sideText;
      top.append(symbol, side);

      const meta = document.createElement("p");
      meta.className = "signal-timeframe";
      const ticket = trade.ticket ?? trade.position_id ?? trade.id;
      meta.textContent = (ticket !== undefined ? "Ticket " + String(ticket) : "EA position") +
        (trade.volume !== undefined || trade.lots !== undefined ? " · Volume " + String(trade.volume ?? trade.lots) : "");

      const grid = document.createElement("div");
      grid.className = "signal-level-grid";
      [
        ["Entry", trade.entry_price ?? trade.price_open ?? trade.entry],
        ["Stop loss", trade.sl ?? trade.stop_loss],
        ["Take profit", trade.tp ?? trade.take_profit],
        ["Profit", trade.profit ?? trade.profit_loss]
      ].forEach(([label, value]) => {
        const cell = document.createElement("div");
        const caption = document.createElement("span");
        caption.textContent = label;
        const strong = document.createElement("strong");
        strong.textContent = value === undefined || value === null || value === "" ? "—" : String(value);
        cell.append(caption, strong);
        grid.append(cell);
      });

      const foot = document.createElement("div");
      foot.className = "signal-card-foot";
      const state = document.createElement("span");
      state.textContent = "OPEN";
      const time = document.createElement("time");
      time.textContent = formatDateTime(trade.open_time || trade.time || trade.timestamp);
      foot.append(state, time);
      card.append(top, meta, grid, foot);
      host.append(card);
    });
  }

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
    setDot(eaConnected ? "#d8d8d8" : "#777777");

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
    checkForNewTrades(data);
    renderEATrades(data);
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
    setDot("#a6a6a6");

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
      const target = tab.dataset.target;
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.dataset.view === target);
      });
      document.querySelectorAll(".tab").forEach((item) => {
        item.classList.toggle("active", item.dataset.target === target);
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
  setupNotifications();

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