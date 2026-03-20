(function () {
  let supabaseClient = null;
  let bootPromise = null;
  let refreshInFlight = null;
  let resumeRefreshBound = false;
  let protectedRequestObserver = null;

  function readConfigFromWindow() {
    return {
      url: window.WRITIOR_SUPABASE_URL || null,
      key: window.WRITIOR_SUPABASE_ANON_KEY || null,
    };
  }

  async function fetchPublicConfig() {
    try {
      const res = await fetch("/api/public-config", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json();
      return {
        url: data?.supabase_url || null,
        key: data?.supabase_anon_key || null,
      };
    } catch (_err) {
      return null;
    }
  }

  async function ensureSupabaseClient() {
    if (supabaseClient) {
      return supabaseClient;
    }

    if (!bootPromise) {
      bootPromise = (async () => {
        const initial = readConfigFromWindow();
        let config = initial;

        if (!config.url || !config.key) {
          const remoteConfig = await fetchPublicConfig();
          if (remoteConfig) {
            config = {
              url: config.url || remoteConfig.url,
              key: config.key || remoteConfig.key,
            };
          }
        }

        if (
          typeof window !== "undefined" &&
          window.supabase &&
          typeof window.supabase.createClient === "function" &&
          config.url &&
          config.key
        ) {
          window.WRITIOR_SUPABASE_URL = config.url;
          window.WRITIOR_SUPABASE_ANON_KEY = config.key;
          supabaseClient = window.supabase.createClient(config.url, config.key);
        }

        return supabaseClient;
      })();
    }

    return bootPromise;
  }

  async function getSession() {
    const client = await ensureSupabaseClient();
    if (!client) {
      return {
        data: { session: null },
        error: new Error("Supabase client unavailable"),
      };
    }
    const session = await client.auth.getSession();
    if (session?.data?.session?.access_token || !client.auth.refreshSession) {
      return session;
    }
    if (!refreshInFlight) {
      refreshInFlight = client.auth.refreshSession().finally(() => {
        refreshInFlight = null;
      });
    }
    const refreshed = await refreshInFlight.catch((error) => ({ error }));
    if (refreshed?.data?.session?.access_token) {
      return refreshed;
    }
    if (refreshed?.error) {
      return {
        data: { session: null },
        error: refreshed.error,
      };
    }
    return session;
  }

  async function setSession(tokens) {
    const client = await ensureSupabaseClient();
    if (!client) {
      return {
        data: { session: null },
        error: new Error("Supabase client unavailable"),
      };
    }
    return client.auth.setSession(tokens);
  }

  async function onAuthStateChange(callback) {
    const client = await ensureSupabaseClient();
    if (!client) {
      return { data: { subscription: { unsubscribe() {} } }, error: null };
    }
    return client.auth.onAuthStateChange(callback);
  }

  async function getAccessToken() {
    const { data } = await getSession();
    return data?.session?.access_token || null;
  }

  function defaultMessageForCode(code) {
    if (code === "expired_token") {
      return "Session expired. Please sign in again.";
    }
    if (code === "invalid_token") {
      return "The current session is invalid. Please sign in again.";
    }
    return "Missing bearer token.";
  }

  async function waitForSessionReady({ timeoutMs = 900 } = {}) {
    const startedAt = Date.now();
    let lastSession = null;

    while (Date.now() - startedAt <= timeoutMs) {
      lastSession = await getSession();
      if (lastSession?.data?.session?.access_token) {
        return lastSession;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        break;
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });
    }

    return lastSession || getSession();
  }

  function createAuthSessionError(code = "missing_credentials", message = null, details = {}) {
    const error = new Error(message || (code === "expired_token" ? "Session expired. Please sign in again." : "Missing bearer token."));
    error.name = "AuthSessionError";
    error.code = code;
    error.status = details.status ?? 401;
    error.payload = details.payload ?? null;
    error.requestPath = details.requestPath ?? null;
    error.authSessionLost = true;
    return error;
  }

  function isAuthSessionError(error) {
    return !!error && (error.name === "AuthSessionError" || error.authSessionLost === true || error.code === "missing_credentials" || error.code === "invalid_token" || error.code === "expired_token" || error.code === "auth_required" || error.code === "token_expired" || error.code === "session_lost");
  }

  function createAuthSessionErrorFromPayload(payload, status, requestPath = null) {
    const payloadCode = payload?.error?.code || payload?.error_code || payload?.code || null;
    const authCodes = new Set(["missing_credentials", "invalid_token", "expired_token", "auth_required", "token_expired", "session_lost"]);
    if (!payloadCode && status !== 401) {
      return null;
    }
    const code = authCodes.has(payloadCode) ? payloadCode : (status === 401 ? "missing_credentials" : null);
    if (!code) {
      return null;
    }
    const message = payload?.error?.message || payload?.detail || payload?.message || defaultMessageForCode(code);
    return createAuthSessionError(code, message, { status, payload, requestPath });
  }

  async function authFetch(url, options = {}) {
    const sessionResult = await waitForSessionReady();
    const token = sessionResult?.data?.session?.access_token || null;
    if (!token) {
      const errorMessage = sessionResult?.error?.message || "";
      const code = /expired/i.test(String(errorMessage)) ? "expired_token" : "missing_credentials";
      throw createAuthSessionError(code, code === "expired_token" ? "Session expired. Please sign in again." : "Missing bearer token.", {
        payload: sessionResult?.error ? { error: { message: errorMessage } } : null,
      });
    }
    const headers = new Headers(options.headers || {});
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (typeof protectedRequestObserver === "function") {
      protectedRequestObserver({
        url,
        helper: "authFetch",
        waitedForSessionReady: true,
        authorizationAttached: headers.has("Authorization"),
      });
    }
    return fetch(url, { ...options, headers });
  }

  async function authJson(url, options = {}, { unwrapEnvelope = true } = {}) {
    const res = await authFetch(url, options);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const authError = createAuthSessionErrorFromPayload(payload, res.status, url);
      if (authError) {
        throw authError;
      }
      const error = new Error(payload?.detail || payload?.error?.message || "Request failed");
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    if (unwrapEnvelope && payload && typeof payload === "object" && "ok" in payload && "data" in payload) {
      return payload.data;
    }
    return payload;
  }

  function setProtectedRequestObserver(observer) {
    protectedRequestObserver = typeof observer === "function" ? observer : null;
  }

  function bindResumeRefresh() {
    if (resumeRefreshBound || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const refresh = () => {
      void getSession().catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refresh();
      }
    });
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        refresh();
      }
    });
    resumeRefreshBound = true;
  }

  async function writeLegacyToken(token) {
    const client = await ensureSupabaseClient();
    if (!token && client) {
      client.auth.signOut().catch(() => {});
    }
  }

  async function syncLegacyTokenFromSession() {
    return getAccessToken();
  }

  window.webUnlockerAuth = {
    get client() {
      return supabaseClient;
    },
    ready: ensureSupabaseClient,
    getSession,
    setSession,
    onAuthStateChange,
    getAccessToken,
    waitForSessionReady,
    authFetch,
    authJson,
    isAuthSessionError,
    createAuthSessionError,
    setProtectedRequestObserver,
    syncLegacyTokenFromSession,
    writeLegacyToken,
  };

  ensureSupabaseClient().catch(() => {});
  bindResumeRefresh();
})();
