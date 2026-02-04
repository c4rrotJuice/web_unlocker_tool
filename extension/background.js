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

function openLoginPage() {
  chrome.tabs.create({ url: `${BACKEND_BASE_URL}/static/auth.html` });
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

function decodeJwtExp(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
  try {
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch (error) {
    return null;
  }
}

async function getValidAccessToken({
  minTtlSeconds = 90,
  forceRefresh = false,
} = {}) {
  const session = await getSession();
  if (!session) {
    return null;
  }

  const hasAccessToken = typeof session.access_token === "string";
  if (!hasAccessToken) {
    debug("Missing access token in session");
    forceRefresh = true;
  }

  const decodedExp = decodeJwtExp(session.access_token);
  if (hasAccessToken && !decodedExp) {
    debug("Access token malformed, forcing refresh");
    forceRefresh = true;
  }

  const now = getNowSeconds();
  const tokenExp = decodedExp || session.expires_at;
  const secondsLeft = tokenExp ? tokenExp - now : 0;
  debug("Token TTL check", {
    exp: tokenExp,
    secondsLeft,
    minTtlSeconds,
    forceRefresh,
  });

  // minTtlSeconds avoids using a token that may expire during a multi-step flow.
  if (!forceRefresh && secondsLeft > minTtlSeconds) {
    return session.access_token;
  }

  try {
    debug("Refreshing session", { reason: forceRefresh ? "forced" : "ttl" });
    const refreshed = await refreshSession(session.refresh_token);
    const nextSession = {
      ...session,
      ...refreshed,
    };
    await setSession(nextSession);
    if (typeof nextSession.access_token !== "string") {
      debug("Refresh returned invalid access token");
      await clearSession();
      await clearStorage([USAGE_KEY]);
      return null;
    }
    const refreshedExp =
      decodeJwtExp(nextSession.access_token) || nextSession.expires_at;
    debug("Refresh success", { exp: refreshedExp });
    return nextSession.access_token;
  } catch (error) {
    debug("Refresh failed", { message: error?.message || "unknown" });
    await clearSession();
    await clearStorage([USAGE_KEY]);
    return null;
  }
}

function isAuthFailure(status, data) {
  if (status !== 401 && status !== 403) {
    return false;
  }
  const message = `${data?.detail || data?.error || ""}`.toLowerCase();
  return (
    message.includes("jwt") ||
    message.includes("token") ||
    message.includes("expired") ||
    message.includes("invalid") ||
    status === 401
  );
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
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return { error: "session_expired", status: 401 };
    }
    const session = await getSession();
    if (!session) {
      return { error: "session_expired", status: 401 };
    }

    const response = await apiFetch(
      "/api/extension/selection",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      accessToken,
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
        error:
          data?.detail ||
          data?.error ||
          (isAuthFailure(response.status, data)
            ? "session_expired"
            : "request_failed"),
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
    const handoffPayload = {
      redirect_path: redirectPath,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
    };

    const createHandoff = async (token) =>
      apiFetch(
        "/api/auth/handoff",
        {
          method: "POST",
          body: JSON.stringify(handoffPayload),
        },
        token,
      );

    let handoffResponse = await createHandoff(accessToken);

    let handoffData = null;
    try {
      handoffData = await handoffResponse.json();
    } catch (error) {
      // ignore
    }

    if (!handoffResponse.ok && isAuthFailure(handoffResponse.status, handoffData)) {
      // Retry once after a forced refresh to avoid infinite loops.
      debug("Handoff auth failed, retrying once", {
        status: handoffResponse.status,
      });
      const refreshedToken = await getValidAccessToken({
        minTtlSeconds: 0,
        forceRefresh: true,
      });
      if (refreshedToken) {
        handoffResponse = await createHandoff(refreshedToken);
        try {
          handoffData = await handoffResponse.json();
        } catch (error) {
          // ignore
        }
        debug("Handoff retry outcome", {
          status: handoffResponse.status,
          ok: handoffResponse.ok,
        });
      }
    }

    if (!handoffResponse.ok) {
      if (handoffResponse.status === 401 || isAuthFailure(handoffResponse.status, handoffData)) {
        await clearSession();
        await clearStorage([USAGE_KEY]);
      }
      return {
        status: handoffResponse.status,
        error:
          handoffData?.detail ||
          handoffData?.error ||
          (isAuthFailure(handoffResponse.status, handoffData)
            ? "session_expired"
            : "handoff_failed"),
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
        case "OPEN_LOGIN": {
          openLoginPage();
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
