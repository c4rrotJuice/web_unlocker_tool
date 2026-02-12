(function () {
  let supabaseClient = null;
  let bootPromise = null;
  const ACCESS_COOKIE_NAME = "wu_access_token";

  function writeAccessTokenCookie(token) {
    if (typeof document === "undefined") {
      return;
    }

    if (!token) {
      document.cookie = `${ACCESS_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
      return;
    }

    const encoded = encodeURIComponent(token);
    document.cookie = `${ACCESS_COOKIE_NAME}=${encoded}; Path=/; SameSite=Lax`;
  }

  function readConfigFromWindow() {
    return {
      url: window.WEB_UNLOCKER_SUPABASE_URL || null,
      key: window.WEB_UNLOCKER_SUPABASE_ANON_KEY || null,
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
        url: data?.WEB_UNLOCKER_SUPABASE_URL || null,
        key: data?.WEB_UNLOCKER_SUPABASE_ANON_KEY || null,
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
          window.WEB_UNLOCKER_SUPABASE_URL = config.url;
          window.WEB_UNLOCKER_SUPABASE_ANON_KEY = config.key;
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
    return client.auth.getSession();
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

  async function authFetch(url, options = {}) {
    const token = await getAccessToken();
    const headers = new Headers(options.headers || {});
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, { ...options, headers });
  }

  async function syncLegacyTokenFromSession() {
    const token = await getAccessToken();
    writeAccessTokenCookie(token);
    return token;
  }

  async function writeLegacyToken(token) {
    writeAccessTokenCookie(token);
    const client = await ensureSupabaseClient();
    if (!token && client) {
      client.auth.signOut().catch(() => {});
    }
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
    syncLegacyTokenFromSession,
    writeLegacyToken,
  };

  ensureSupabaseClient()
    .then(async (client) => {
      await syncLegacyTokenFromSession();
      if (client?.auth?.onAuthStateChange) {
        client.auth.onAuthStateChange((_event, session) => {
          writeAccessTokenCookie(session?.access_token || null);
        });
      }
    })
    .catch(() => {});
})();
