(function () {
  let supabaseClient = null;
  let bootPromise = null;

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


  function setServerAuthCookie(token) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const maxAge = token ? "; Max-Age=2592000" : "; Max-Age=0";
    const value = token ? encodeURIComponent(token) : "";
    document.cookie = `wu_access_token=${value}; Path=/; SameSite=Lax${secure}${maxAge}`;
  }

  async function syncServerAuthCookie() {
    const token = await getAccessToken();
    setServerAuthCookie(token);
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
          supabaseClient.auth.onAuthStateChange(() => {
            syncServerAuthCookie().catch(() => {});
          });
          await syncServerAuthCookie();
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
    const result = await client.auth.setSession(tokens);
    await syncServerAuthCookie();
    return result;
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
    return undefined;
  }

  async function writeLegacyToken(token) {
    setServerAuthCookie(token || null);
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

  ensureSupabaseClient().catch(() => {});
})();
