import { apiFetch } from "./lib/api.js";
import { createSupabaseAuthClient } from "./lib/supabase.js";
import { BACKEND_BASE_URL } from "./config.js";

const USAGE_KEY = "usage_snapshot";
const REFRESH_WINDOW_SECONDS = 120;
const supabaseClient = createSupabaseAuthClient();
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


async function setUsageSnapshot(snapshot) {
  await writeStorage({ [USAGE_KEY]: snapshot });
}

async function getUsageSnapshot() {
  const { [USAGE_KEY]: snapshot } = await readStorage([USAGE_KEY]);
  return snapshot || null;
}

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session || null;
}

async function setSession(session) {
  await supabaseClient.auth.setSession(session || null);
}

async function clearSession() {
  await supabaseClient.auth.setSession(null);
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
    const refreshed = await supabaseClient.auth.refreshSession(session.refresh_token);
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


async function logUsageEvent(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/extension/usage-event",
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



async function fetchRecentCitations(limit = 5) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const response = await apiFetch(
    `/api/citations?${params.toString()}`,
    { method: "GET" },
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

async function openAuthedPath(redirectPath) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const handoffResponse = await apiFetch(
    "/api/auth/handoff",
    {
      method: "POST",
      body: JSON.stringify({
        redirect_path: redirectPath,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
      }),
    },
    session.access_token,
  );

  let handoffData = null;
  try {
    handoffData = await handoffResponse.json();
  } catch (error) {
    // ignore
  }

  if (!handoffResponse.ok) {
    if (handoffResponse.status === 401) {
      await clearSession();
      await clearStorage([USAGE_KEY]);
    }
    return {
      status: handoffResponse.status,
      error: handoffData?.detail || handoffData?.error || "handoff_failed",
    };
  }

  if (!handoffData?.code) {
    return {
      status: handoffResponse.status,
      error: "handoff_code_missing",
    };
  }

  const handoffUrl = `${BACKEND_BASE_URL}/auth/handoff?code=${encodeURIComponent(
    handoffData.code,
  )}`;
  chrome.tabs.create({ url: handoffUrl });
  return { status: 200, data: { redirect_path: redirectPath } };
}

async function workInEditor(payload) {
  try {
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

    if (!response.ok) {
      return {
        status: response.status,
        error: data?.detail || data?.error || "request_failed",
      };
    }

    if (!data?.editor_url) {
      return {
        status: response.status,
        error: "missing_editor_url",
      };
    }

    const normalizeRedirectPath = (editorUrl) => {
      if (!editorUrl) {
        return "/editor";
      }
      if (editorUrl.startsWith("/")) {
        if (editorUrl.includes("//")) {
          return "/editor";
        }
        return editorUrl;
      }

      try {
        const baseUrl = new URL(BACKEND_BASE_URL);
        const parsedUrl = new URL(editorUrl, baseUrl);
        if (parsedUrl.origin !== baseUrl.origin) {
          return "/editor";
        }
        const path = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        if (!path.startsWith("/") || path.includes("//")) {
          return "/editor";
        }
        return path;
      } catch (error) {
        return "/editor";
      }
    };

    const redirectPath = normalizeRedirectPath(data.editor_url);
    const handoffResult = await openAuthedPath(redirectPath);
    if (handoffResult?.status && handoffResult.status >= 400) {
      return handoffResult;
    }

    return { status: response.status, data };
  } catch (error) {
    return { error: error?.message || "unexpected_error" };
  }
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
          const { data } = await supabaseClient.auth.signInWithPassword({
            email: message.email,
            password: message.password,
          });
          await clearStorage([USAGE_KEY]);
          sendResponse({ session: data?.session || null });
          break;
        }
        case "signup": {
          const { data } = await supabaseClient.auth.signUp({
            email: message.email,
            password: message.password,
          });
          await clearStorage([USAGE_KEY]);
          sendResponse({ session: data?.session || null });
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
        case "GET_RECENT_CITATIONS": {
          const limit = Number.isFinite(message.limit) ? message.limit : 5;
          const safeLimit = Math.max(1, Math.min(5, limit));
          const result = await fetchRecentCitations(safeLimit);
          debug("GET_RECENT_CITATIONS result", result);
          sendResponse(result);
          break;
        }
        case "WORK_IN_EDITOR": {
          const result = await workInEditor(message.payload || {});
          debug("WORK_IN_EDITOR result", result);
          sendResponse(result);
          break;
        }
        case "LOG_USAGE_EVENT": {
          const result = await logUsageEvent(message.payload || {});
          debug("LOG_USAGE_EVENT result", result);
          sendResponse(result);
          break;
        }
        case "OPEN_EDITOR": {
          const result = await openAuthedPath("/editor");
          debug("OPEN_EDITOR result", result);
          sendResponse(result);
          break;
        }
        case "OPEN_DASHBOARD": {
          const result = await openAuthedPath("/dashboard");
          debug("OPEN_DASHBOARD result", result);
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
