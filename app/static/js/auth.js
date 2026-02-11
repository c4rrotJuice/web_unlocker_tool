(function () {
  const SUPABASE_URL = window.WEB_UNLOCKER_SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.WEB_UNLOCKER_SUPABASE_ANON_KEY;

  const canUseSupabase =
    typeof window !== "undefined" &&
    window.supabase &&
    typeof window.supabase.createClient === "function" &&
    !!SUPABASE_URL &&
    !!SUPABASE_ANON_KEY;

  const supabaseClient = canUseSupabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  function readLegacyToken() {
    return localStorage.getItem("access_token") || null;
  }

  function writeLegacyToken(token) {
    if (token) {
      localStorage.setItem("access_token", token);
      document.cookie = `access_token=${token}; Path=/; SameSite=Lax`;
    } else {
      localStorage.removeItem("access_token");
      document.cookie = "access_token=; Path=/; Max-Age=0; SameSite=Lax";
    }
  }

  async function getSession() {
    if (!supabaseClient) {
      const accessToken = readLegacyToken();
      return { data: { session: accessToken ? { access_token: accessToken } : null }, error: null };
    }
    return supabaseClient.auth.getSession();
  }

  async function setSession(tokens) {
    if (!supabaseClient) {
      writeLegacyToken(tokens?.access_token || null);
      return { data: { session: tokens || null }, error: null };
    }
    return supabaseClient.auth.setSession(tokens);
  }

  function onAuthStateChange(callback) {
    if (!supabaseClient) {
      return { data: { subscription: { unsubscribe() {} } } };
    }
    return supabaseClient.auth.onAuthStateChange(callback);
  }

  async function getAccessToken() {
    const { data } = await getSession();
    return data?.session?.access_token || readLegacyToken();
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
    writeLegacyToken(token || null);
  }

  onAuthStateChange((_event, session) => {
    writeLegacyToken(session?.access_token || null);
  });

  window.webUnlockerAuth = {
    client: supabaseClient,
    getSession,
    setSession,
    onAuthStateChange,
    getAccessToken,
    authFetch,
    syncLegacyTokenFromSession,
    writeLegacyToken,
  };
})();
