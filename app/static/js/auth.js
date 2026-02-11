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

  async function getSession() {
    if (!supabaseClient) {
      return { data: { session: null }, error: new Error("Supabase client unavailable") };
    }
    return supabaseClient.auth.getSession();
  }

  async function setSession(tokens) {
    if (!supabaseClient) {
      return { data: { session: null }, error: new Error("Supabase client unavailable") };
    }
    return supabaseClient.auth.setSession(tokens);
  }

  function onAuthStateChange(callback) {
    if (!supabaseClient) {
      return { data: { subscription: { unsubscribe() {} } }, error: null };
    }
    return supabaseClient.auth.onAuthStateChange(callback);
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

  function writeLegacyToken(_token) {
    if (supabaseClient) {
      supabaseClient.auth.signOut().catch(() => {});
    }
  }

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
