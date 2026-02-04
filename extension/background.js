import { apiFetch } from "./lib/api.js";
import {
  loginWithPassword,
  refreshSession,
  signupWithPassword,
} from "./lib/supabase.js";
import { BACKEND_BASE_URL } from "./config.js";

const SESSION_KEY = "session";
const USAGE_KEY = "usage_snapshot";
const REFRESH_WINDOW_SECONDS = 120;
let debugEnabled = false;
const debug = (...args) => {
  if (debugEnabled) {
    console.debug("[Web Unlocker]", ...args);
  }
};

chrome.storage.local
  .get({ webUnlockerDebug: false })
  .then(({ webUnlockerDebug }) => {
    debugEnabled = Boolean(webUnlockerDebug);
  })
  .catch(() => {
    debugEnabled = false;
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.webUnlockerDebug) {
    return;
  }
  debugEnabled = Boolean(changes.webUnlockerDebug.newValue);
});

function getNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function readStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function writeStorage(payload) {
  await chrome.storage.local.set(payload);
}

async function clearStorage(keys) {
  await chrome.storage.local.remove(keys);
}

async function getSession() {
  const { [SESSION_KEY]: session } = await readStorage([SESSION_KEY]);
  return session || null;
}

async function setSession(session) {
  await writeStorage({ [SESSION_KEY]: session });
}

async function clearSession() {
  await clearStorage([SESSION_KEY]);
}

async function setUsageSnapshot(snapshot) {
  await writeStorage({ [USAGE_KEY]: snapshot });
}

async function getUsageSnapshot() {
  const { [USAGE_KEY]: snapshot } = await readStorage([USAGE_KEY]);
  return snapshot || null;
}

async function ensureValidSession() {
  const session = await getSession();
  if (!session) {
    return null;
  }
  const expiresAt = session.expires_at || 0;
  if (expiresAt - getNowSeconds() > REFRESH_WINDOW_SECONDS) {
    return session;
  }

  try {
    const refreshed = await refreshSession(session.refresh_token);
    const nextSession = {
      ...session,
      ...refreshed,
    };
    await setSession(nextSession);
    return nextSession;
  } catch (error) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
    return null;
  }
}

async function fetchUnlockPermit(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "Not authenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/extension/unlock-permit",
    {
      method: "POST",
      body: JSON.stringify(payload || {}),
    },
    session.access_token,
  );

  if (response.status === 401) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  if (response.ok && data) {
    await setUsageSnapshot(data);
  }

  return { status: response.status, data };
}

async function saveCitation(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/citations",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    session.access_token,
  );

  if (response.status === 401) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  return { status: response.status, data };
}

async function workInEditor(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/extension/selection",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    session.access_token,
  );

  if (response.status === 401) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  if (response.ok && data?.editor_url) {
    const handoffResponse = await apiFetch(
      "/api/auth/handoff",
      {
        method: "POST",
        body: JSON.stringify({ redirect_path: data.editor_url }),
      },
      session.access_token,
    );

    let handoffData = null;
    try {
      handoffData = await handoffResponse.json();
    } catch (error) {
      // ignore
    }

    if (handoffResponse.ok && handoffData?.code) {
      const handoffUrl = `${BACKEND_BASE_URL}/auth/handoff?code=${encodeURIComponent(
        handoffData.code,
      )}`;
      chrome.tabs.create({ url: handoffUrl });
      return { status: response.status, data };
    }

    if (handoffResponse.status === 401) {
      await clearSession();
      await clearStorage([USAGE_KEY]);
      return { status: 401, data: handoffData };
    }

    chrome.tabs.create({ url: `${BACKEND_BASE_URL}/static/auth.html` });
  }

  return { status: response.status, data };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return false;
  }

  (async () => {
    try {
      debug("Incoming message", {
        type: message.type,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      });
      switch (message.type) {
        case "login": {
          const session = await loginWithPassword(
            message.email,
            message.password,
          );
          await setSession(session);
          await clearStorage([USAGE_KEY]);
          sendResponse({ session });
          break;
        }
        case "signup": {
          const session = await signupWithPassword(
            message.email,
            message.password,
          );
          await setSession(session);
          await clearStorage([USAGE_KEY]);
          sendResponse({ session });
          break;
        }
        case "logout": {
          await clearSession();
          await clearStorage([USAGE_KEY]);
          sendResponse({ success: true });
          break;
        }
        case "get-session": {
          const session = await ensureValidSession();
          const usage = await getUsageSnapshot();
          sendResponse({ session, usage });
          break;
        }
        case "check-unlock": {
          const result = await fetchUnlockPermit({
            url: message.url || null,
          });
          sendResponse(result);
          break;
        }
        case "peek-unlock": {
          const result = await fetchUnlockPermit({
            url: message.url || null,
            dry_run: true,
          });
          sendResponse(result);
          break;
        }
        case "SAVE_CITATION": {
          const result = await saveCitation(message.payload || {});
          debug("SAVE_CITATION result", result);
          sendResponse(result);
          break;
        }
        case "WORK_IN_EDITOR": {
          const result = await workInEditor(message.payload || {});
          debug("WORK_IN_EDITOR result", result);
          sendResponse(result);
          break;
        }
        default:
          sendResponse({ error: "Unknown message type." });
      }
    } catch (error) {
      debug("Message handler error", error);
      sendResponse({ error: error.message || "Unexpected error." });
    }
  })();

  return true;
});
