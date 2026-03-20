(function () {
  let supabaseClient = null;
  let bootPromise = null;
  let refreshInFlight = null;
  let resumeRefreshBound = false;

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

  async function requireAccessToken() {
    const sessionResult = await getSession();
    const token = sessionResult?.data?.session?.access_token || null;
    if (!token) {
      const errorMessage = sessionResult?.error?.message || "";
      const code = /expired/i.test(String(errorMessage)) ? "expired_token" : "missing_credentials";
      throw createAuthSessionError(code, code === "expired_token" ? "Session expired. Please sign in again." : "Missing bearer token.", {
        payload: sessionResult?.error ? { error: { message: errorMessage } } : null,
      });
    }
    return token;
  }

  async function authFetch(url, options = {}) {
    const token = await requireAccessToken();
    const headers = new Headers(options.headers || {});
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { ...options, headers });
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
    authFetch,
    isAuthSessionError,
    createAuthSessionError,
    syncLegacyTokenFromSession,
    writeLegacyToken,
  };

  ensureSupabaseClient().catch(() => {});
  bindResumeRefresh();
})();
