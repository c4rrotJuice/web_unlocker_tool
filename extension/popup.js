import { BACKEND_BASE_URL } from "./config.js";

const DEBUG = false;
const debug = (...args) => {
  if (DEBUG) {
    console.debug("[Web Unlocker popup]", ...args);
  }
};

const statusEl = document.getElementById("status");
const signedOutPanel = document.getElementById("signed-out");
const signedInPanel = document.getElementById("signed-in");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login");
const signupButton = document.getElementById("signup");
const logoutButton = document.getElementById("logout");
const checkButton = document.getElementById("check-usage");
const upgradeButton = document.getElementById("upgrade");
const enableButton = document.getElementById("enable-copy-cite");
const userEmailEl = document.getElementById("user-email");
const userTierEl = document.getElementById("user-tier");
const remainingEl = document.getElementById("remaining");
const resetAtEl = document.getElementById("reset-at");
const usageInfoEl = document.getElementById("usage-info");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b42318" : "#596173";
}

function formatReset(resetAt) {
  if (!resetAt) return "--";
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return resetAt;
  return date.toLocaleString();
}

function renderSignedOut() {
  signedInPanel.classList.add("hidden");
  signedOutPanel.classList.remove("hidden");
  usageInfoEl.classList.add("hidden");
}

function renderSignedIn(session, usage) {
  signedOutPanel.classList.add("hidden");
  signedInPanel.classList.remove("hidden");
  userEmailEl.textContent = session?.user?.email || "--";
  if (usage?.account_type) {
    userTierEl.textContent = usage.account_type;
  } else {
    userTierEl.textContent = "Unknown";
  }
  if (usage) {
    usageInfoEl.classList.remove("hidden");
    remainingEl.textContent =
      usage.remaining < 0 ? "Unlimited" : `${usage.remaining}`;
    resetAtEl.textContent = formatReset(usage.reset_at);
  } else {
    usageInfoEl.classList.add("hidden");
  }
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
    renderSignedOut();
    setStatus(`Extension error: ${response.error}`, true);
    return;
  }
  if (response?.session) {
    renderSignedIn(response.session, response.usage);
    setStatus("Signed in.");
    if (!response.usage) {
      const peek = await sendMessage("peek-unlock", {
        url: await getCurrentTabUrl(),
      });
      if (peek?.error) {
        setStatus(`Extension error: ${peek.error}`, true);
        return;
      }
      const refreshed = await sendMessage("get-session");
      if (refreshed?.error) {
        setStatus(`Extension error: ${refreshed.error}`, true);
        return;
      }
      renderSignedIn(refreshed.session, refreshed.usage);
    }
  } else {
    renderSignedOut();
    setStatus("Signed out.");
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
  renderSignedOut();
  setStatus("Signed out.");
});

checkButton.addEventListener("click", async () => {
  setStatus("Checking allowance…");
  const url = await getCurrentTabUrl();
  const response = await sendMessage("check-unlock", { url });
  if (response?.error) {
    setStatus(`Extension error: ${response.error}`, true);
    return;
  }
  if (response?.status === 401) {
    renderSignedOut();
    setStatus("Session expired. Please sign in again.", true);
    return;
  }
  if (response?.data) {
    renderSignedIn(
      (await sendMessage("get-session")).session,
      response.data,
    );
    if (!response.data.allowed) {
      setStatus("Limit reached. Upgrade for more unlocks.", true);
    } else {
      setStatus("Usage updated.");
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
    await chrome.scripting.executeScript({
      // Inject into all frames so iframe selections can be handled.
      target: { tabId: tab.id, allFrames: true },
      files: ["content/unlock_content.js"],
    });
    setStatus("Copy+Cite enabled on this page.");
  } catch (error) {
    debug("Failed to inject content script.", error);
    setStatus("Failed to inject content script.", true);
  }
});

loadSession();
