import { BACKEND_BASE_URL } from "./config.js";

const DEBUG = false;
const debug = (...args) => {
  if (DEBUG) {
    console.debug("[Web Unlocker popup]", ...args);
  }
};

const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");
const signedOutPanel = document.getElementById("signed-out");
const signedInPanel = document.getElementById("signed-in");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login");
const signupButton = document.getElementById("signup");
const logoutButton = document.getElementById("logout");
const checkButton = document.getElementById("check-usage");
const upgradeButton = document.getElementById("upgrade");
const openEditorButton = document.getElementById("open-editor");
const openDashboardButton = document.getElementById("open-dashboard");
const enableButton = document.getElementById("enable-copy-cite");
const userEmailEl = document.getElementById("user-email");
const userTierEl = document.getElementById("user-tier");
const remainingEl = document.getElementById("remaining");
const resetAtEl = document.getElementById("reset-at");
const usageInfoEl = document.getElementById("usage-info");
const citationHistoryEl = document.getElementById("citation-history");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b42318" : "#596173";
}

function showToast(message, isError = false) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  toastEl.classList.toggle("error", Boolean(isError));
  setTimeout(() => {
    toastEl.classList.add("hidden");
  }, 3000);
}

function formatReset(resetAt) {
  if (!resetAt) return "--";
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return resetAt;
  return date.toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  const intervals = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];

  for (const [interval, label] of intervals) {
    const count = Math.floor(seconds / interval);
    if (count >= 1) {
      return `${count} ${label}${count > 1 ? "s" : ""}`;
    }
  }

  return "just now";
}

function renderCitationHistoryUnavailable() {
  if (!citationHistoryEl) return;
  citationHistoryEl.innerHTML = '<li class="citation-history-empty"><p>citation history for logged-in users.</p></li>';
}

async function loadCitationHistory() {
  if (!citationHistoryEl) return;

  const sessionState = await sendMessage("get-session");
  if (!sessionState?.session) {
    renderCitationHistoryUnavailable();
    return;
  }

  citationHistoryEl.innerHTML = "<li><p>Fetching ...</p></li>";
  const response = await sendMessage("GET_RECENT_CITATIONS", { limit: 5 });

  if (response?.status === 401 || response?.error === "unauthenticated") {
    renderCitationHistoryUnavailable();
    return;
  }

  if (response?.error || !Array.isArray(response?.data)) {
    citationHistoryEl.innerHTML = '<li class="citation-history-empty"><p>Could not load citations.</p></li>';
    return;
  }

  const citations = response.data.slice(0, 5);
  if (!citations.length) {
    citationHistoryEl.innerHTML = '<li class="citation-history-empty"><p>No recent citations yet.</p></li>';
    return;
  }

  citationHistoryEl.innerHTML = "";
  citations.forEach((citation) => {
    const li = document.createElement("li");
    li.className = "citation-item";

    const excerpt = escapeHtml(citation.excerpt || "No excerpt available");
    const citedAt = citation.cited_at ? new Date(citation.cited_at) : null;
    const timeAgo = citedAt && !Number.isNaN(citedAt.getTime()) ? `${timeSince(citedAt)} ago` : "Recently";

    const excerptDiv = document.createElement("div");
    excerptDiv.className = "citation-excerpt";
    excerptDiv.innerHTML = `
      <span>${excerpt}</span>
      <span class="badge">${escapeHtml(timeAgo)}</span>
    `;

    const modalDiv = document.createElement("div");
    modalDiv.className = "citation-modal";

    const fullTextP = document.createElement("p");
    fullTextP.textContent = citation.full_text || "";

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-button";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy Again";
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(citation.full_text || "");
        showToast("Full citation copied!");
      } catch (error) {
        showToast("Failed to copy full citation.", true);
      }
    });

    modalDiv.appendChild(fullTextP);
    modalDiv.appendChild(copyBtn);

    li.appendChild(excerptDiv);
    li.appendChild(modalDiv);
    citationHistoryEl.appendChild(li);
  });
}

function renderUsage(usage) {
  if (!usage) {
    usageInfoEl.classList.add("hidden");
    return;
  }

  usageInfoEl.classList.remove("hidden");
  const periodLabel = usage.usage_period
    ? usage.usage_period === "day"
      ? "today"
      : usage.usage_period === "week"
        ? "this week"
        : "unlimited"
    : "this week";

  remainingEl.textContent =
    usage.remaining < 0
      ? "Unlimited usages"
      : `${usage.remaining} usages ${periodLabel}`;
  resetAtEl.textContent = usage.remaining < 0 ? "--" : formatReset(usage.reset_at);
}

function renderSessionPanels(session, usage) {
  if (session) {
    signedOutPanel.classList.add("hidden");
    signedInPanel.classList.remove("hidden");
    userEmailEl.textContent = session?.user?.email || "--";
    userTierEl.textContent = usage?.account_type || "Unknown";
    loadCitationHistory();
  } else {
    signedInPanel.classList.add("hidden");
    signedOutPanel.classList.remove("hidden");
    renderCitationHistoryUnavailable();
  }

  renderUsage(usage);
}

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function getCurrentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || null;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function buildUsageEventPayload(url) {
  const eventId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { url, event_id: eventId };
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("moz-extension://")
  );
}

async function loadSession() {
  setStatus("Checking session…");
  const response = await sendMessage("get-session");
  if (response?.error) {
    renderSessionPanels(null, null);
    setStatus(`Extension error: ${response.error}`, true);
    return;
  }

  renderSessionPanels(response?.session || null, response?.usage || null);
  if (response?.session) {
    setStatus("Signed in.");
  } else {
    setStatus("Signed out.");
  }

  if (!response?.usage) {
    const peek = await sendMessage("peek-unlock", {
      url: await getCurrentTabUrl(),
    });
    if (peek?.error) {
      setStatus(`Extension error: ${peek.error}`, true);
      return;
    }
    if (peek?.status && peek.status >= 400) {
      setStatus("Signed out.");
      return;
    }
    if (peek?.data) {
      const refreshed = await sendMessage("get-session");
      if (refreshed?.error) {
        setStatus(`Extension error: ${refreshed.error}`, true);
        return;
      }
      renderSessionPanels(refreshed?.session || null, peek.data);
    }
  }
}

loginButton.addEventListener("click", async () => {
  setStatus("Signing in…");
  try {
    const session = await sendMessage("login", {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (session?.error) {
      throw new Error(session.error);
    }
    await loadSession();
  } catch (error) {
    setStatus(error.message || "Login failed.", true);
  }
});

signupButton.addEventListener("click", async () => {
  setStatus("Creating account…");
  try {
    const session = await sendMessage("signup", {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });
    if (session?.error) {
      throw new Error(session.error);
    }
    await loadSession();
  } catch (error) {
    setStatus(error.message || "Signup failed.", true);
  }
});

logoutButton.addEventListener("click", async () => {
  setStatus("Signing out…");
  await sendMessage("logout");
  await loadSession();
  loadCitationHistory();
});

checkButton.addEventListener("click", async () => {
  setStatus("Checking allowance…");
  const url = await getCurrentTabUrl();
  const response = await sendMessage("peek-unlock", { url });
  if (response?.error) {
    setStatus(`Extension error: ${response.error}`, true);
    return;
  }
  if (response?.data) {
    const sessionState = await sendMessage("get-session");
    renderSessionPanels(sessionState?.session || null, response.data);
    if (!response.data.allowed) {
      setStatus("Limit reached. Upgrade for more unlocks.", true);
    } else {
      setStatus("Allowance checked.");
    }
    return;
  }
  setStatus("Failed to check usage.", true);
});

upgradeButton.addEventListener("click", () => {
  chrome.tabs.create({ url: `${BACKEND_BASE_URL}/static/pricing.html` });
});

enableButton.addEventListener("click", async () => {
  setStatus("Enabling Copy+Cite…");
  try {
    const tab = await getCurrentTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) {
      setStatus("Cannot run on this page.", true);
      return;
    }
    const usage = await sendMessage("check-unlock", { url: tab.url });
    if (usage?.error) {
      setStatus(`Extension error: ${usage.error}`, true);
      return;
    }
    if (usage?.data) {
      const sessionState = await sendMessage("get-session");
      renderSessionPanels(sessionState?.session || null, usage.data);
      if (!usage.data.allowed) {
        setStatus("Limit reached. Upgrade for more unlocks.", true);
        return;
      }
    }

    const sessionState = await sendMessage("get-session");
    if (sessionState?.session) {
      const usageEvent = await sendMessage("LOG_USAGE_EVENT", {
        payload: buildUsageEventPayload(tab.url),
      });
      if (usageEvent?.status && usageEvent.status >= 400) {
        setStatus("Copy+Cite enabled, but usage sync failed.", true);
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content/unlock_content.js"],
    });
    setStatus("Copy+Cite enabled on this page.");
  } catch (error) {
    debug("Failed to inject content script.", error);
    setStatus("Failed to inject content script.", true);
  }
});

openEditorButton.addEventListener("click", async () => {
  setStatus("Opening editor…");
  const sessionState = await sendMessage("get-session");
  const accountType = sessionState?.usage?.account_type;
  if (accountType === "freemium" || accountType === "anonymous") {
    showToast("Editor usage is a paid feature. Please upgrade your plan.", true);
    setStatus("Upgrade required for editor access.", true);
    return;
  }

  const response = await sendMessage("OPEN_EDITOR");
  if (response?.error) {
    setStatus(response.error, true);
    return;
  }
  if (response?.status === 401) {
    renderSessionPanels(null, sessionState?.usage || null);
    setStatus("Session expired. Please sign in again.", true);
    return;
  }
  if (response?.status && response.status >= 400) {
    setStatus(response.error || "Could not open editor.", true);
    return;
  }
  setStatus("Opened editor in new tab.");
});

openDashboardButton.addEventListener("click", async () => {
  setStatus("Opening dashboard…");
  const response = await sendMessage("OPEN_DASHBOARD");
  if (response?.error) {
    setStatus(response.error, true);
    return;
  }
  if (response?.status === 401) {
    await loadSession();
    setStatus("Session expired. Please sign in again.", true);
    return;
  }
  if (response?.status && response.status >= 400) {
    setStatus(response.error || "Could not open dashboard.", true);
    return;
  }
  setStatus("Opened dashboard in new tab.");
});

loadSession();
loadCitationHistory();
