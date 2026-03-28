(function () {
  let supabaseClient = null;
  let bootPromise = null;
  let sessionReadInFlight = null;
  let refreshInFlight = null;
  let resumeRefreshBound = false;
  let protectedRequestObserver = null;
  let cachedSession = null;
  const runtimeDebugEnabled = !!window.__WRITIOR_RUNTIME_DEBUG__;
  const runtimeDebugCounts = {
    clientCreated: 0,
    subscriberRegistered: 0,
    getSessionCalls: 0,
    waitForSessionReadyCalls: 0,
    authFetchCalls: 0,
    authJsonCalls: 0,
  };

  function debugAuth(event, details = {}) {
    if (!runtimeDebugEnabled || typeof console === "undefined" || typeof console.debug !== "function") {
      return;
    }
    console.debug("[writior:auth]", event, details);
  }

  function rememberSession(session) {
    cachedSession = session && session.access_token ? { ...session } : null;
  }

  function clearSessionCache() {
    cachedSession = null;
  }

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
          runtimeDebugCounts.clientCreated += 1;
          debugAuth("client_created", { count: runtimeDebugCounts.clientCreated });
        }

        return supabaseClient;
      })();
    }

    return bootPromise;
  }

  async function getSession({ forceRefresh = false } = {}) {
    runtimeDebugCounts.getSessionCalls += 1;
    debugAuth("get_session_enter", {
      count: runtimeDebugCounts.getSessionCalls,
      cached: !!cachedSession?.access_token,
      forceRefresh,
      refreshPending: !!refreshInFlight,
    });
    if (!forceRefresh && cachedSession?.access_token) {
      debugAuth("get_session_cache_hit", { count: runtimeDebugCounts.getSessionCalls });
      return {
        data: { session: cachedSession },
        error: null,
      };
    }
    if (sessionReadInFlight) {
      return sessionReadInFlight;
    }
    sessionReadInFlight = (async () => {
      const client = await ensureSupabaseClient();
      if (!client) {
        return {
          data: { session: null },
          error: new Error("Supabase client unavailable"),
        };
      }
      const session = await client.auth.getSession();
      const currentSession = session?.data?.session || null;
      rememberSession(currentSession);
      if (currentSession?.access_token || !client.auth.refreshSession) {
        debugAuth("get_session_exit", {
          count: runtimeDebugCounts.getSessionCalls,
          cached: !!cachedSession?.access_token,
          refreshed: false,
        });
        return session;
      }
      if (!refreshInFlight) {
        refreshInFlight = client.auth.refreshSession().finally(() => {
          refreshInFlight = null;
        });
      }
      const refreshed = await refreshInFlight.catch((error) => ({ error }));
      const refreshedSession = refreshed?.data?.session || null;
      if (refreshedSession?.access_token) {
        rememberSession(refreshedSession);
        debugAuth("get_session_exit", {
          count: runtimeDebugCounts.getSessionCalls,
          cached: !!cachedSession?.access_token,
          refreshed: true,
        });
        return refreshed;
      }
      if (refreshed?.error) {
        clearSessionCache();
        debugAuth("get_session_exit", {
          count: runtimeDebugCounts.getSessionCalls,
          cached: false,
          refreshed: false,
          error: refreshed.error?.message || "refresh_failed",
        });
        return {
          data: { session: null },
          error: refreshed.error,
        };
      }
      debugAuth("get_session_exit", {
        count: runtimeDebugCounts.getSessionCalls,
        cached: !!cachedSession?.access_token,
        refreshed: false,
      });
      return session;
    })().finally(() => {
      sessionReadInFlight = null;
    });
    return sessionReadInFlight;
  }

  async function setSession(tokens) {
    const client = await ensureSupabaseClient();
    if (!client) {
      return {
        data: { session: null },
        error: new Error("Supabase client unavailable"),
      };
    }
    const result = await client.auth.setSession(tokens);
    rememberSession(result?.data?.session || null);
    return result;
  }

  async function onAuthStateChange(callback) {
    const client = await ensureSupabaseClient();
    if (!client) {
      return { data: { subscription: { unsubscribe() {} } }, error: null };
    }
    runtimeDebugCounts.subscriberRegistered += 1;
    debugAuth("subscriber_registered", { count: runtimeDebugCounts.subscriberRegistered });
    return client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESH_FAILED") {
        clearSessionCache();
      } else if (session?.access_token) {
        rememberSession(session);
      }
      return callback(event, session);
    });
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

  function extractMessageCandidate(value) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const messages = value
        .map((entry) => extractMessageCandidate(entry))
        .filter(Boolean);
      return messages.length ? messages.join("; ") : null;
    }
    if (value && typeof value === "object") {
      return (
        extractMessageCandidate(value.message)
        || extractMessageCandidate(value.msg)
        || extractMessageCandidate(value.detail)
        || extractMessageCandidate(value.description)
        || null
      );
    }
    return null;
  }

  async function waitForSessionReady({ timeoutMs = 900 } = {}) {
    runtimeDebugCounts.waitForSessionReadyCalls += 1;
    debugAuth("wait_for_session_ready", {
      count: runtimeDebugCounts.waitForSessionReadyCalls,
      timeoutMs,
      cached: !!cachedSession?.access_token,
    });
    return getSession();
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
    const message = (
      extractMessageCandidate(payload?.error?.message)
      || extractMessageCandidate(payload?.detail)
      || extractMessageCandidate(payload?.message)
      || defaultMessageForCode(code)
    );
    return createAuthSessionError(code, message, { status, payload, requestPath });
  }

  function isPassthroughBody(body) {
    return (
      typeof body === "string"
      || (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams)
      || (typeof FormData !== "undefined" && body instanceof FormData)
      || (typeof Blob !== "undefined" && body instanceof Blob)
      || (typeof File !== "undefined" && body instanceof File)
      || body instanceof ArrayBuffer
      || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(body))
      || (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
      || (typeof Request !== "undefined" && body instanceof Request)
    );
  }

  function prepareProtectedRequestOptions(options = {}) {
    const headers = new Headers(options.headers || {});
    const prepared = { ...options, headers };
    if (!Object.hasOwn(prepared, "body")) {
      return prepared;
    }

    const body = prepared.body;
    if (body == null || isPassthroughBody(body)) {
      return prepared;
    }

    if (typeof body === "object") {
      prepared.body = JSON.stringify(body);
      headers.set("Content-Type", "application/json");
    }

    return prepared;
  }

  async function authFetch(url, options = {}) {
    runtimeDebugCounts.authFetchCalls += 1;
    let token = cachedSession?.access_token || null;
    let sessionError = null;
    if (!token) {
      const sessionResult = await waitForSessionReady();
      token = sessionResult?.data?.session?.access_token || null;
      sessionError = sessionResult?.error || null;
    }
    if (!token) {
      const errorMessage = sessionError?.message || "Missing bearer token.";
      const code = /expired/i.test(String(errorMessage)) ? "expired_token" : "missing_credentials";
      throw createAuthSessionError(code, code === "expired_token" ? "Session expired. Please sign in again." : "Missing bearer token.", {
        payload: sessionError ? { error: { message: errorMessage } } : null,
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
    return fetch(url, prepareProtectedRequestOptions({ ...options, headers }));
  }

  async function authJson(url, options = {}, { unwrapEnvelope = true } = {}) {
    runtimeDebugCounts.authJsonCalls += 1;
    const res = await authFetch(url, options);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const authError = createAuthSessionErrorFromPayload(payload, res.status, url);
      if (authError) {
        throw authError;
      }
      const error = new Error(
        extractMessageCandidate(payload?.detail)
        || extractMessageCandidate(payload?.error?.message)
        || extractMessageCandidate(payload?.message)
        || "Request failed"
      );
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
      void getSession({ forceRefresh: true }).catch(() => {});
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

  window.webUnlockerAuth = {
    get client() {
      return supabaseClient;
    },
    get sessionSnapshot() {
      return cachedSession;
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
  };

  ensureSupabaseClient().catch(() => {});
  bindResumeRefresh();
})();
