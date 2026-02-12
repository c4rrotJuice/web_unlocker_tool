import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";

const SESSION_STORAGE_KEY = "session";
const authListeners = new Set();

function supabaseFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("apikey", SUPABASE_ANON_KEY);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers,
  });
}

function buildSessionPayload(payload) {
  if (!payload) return null;
  const expiresIn = payload.expires_in ?? 0;
  const expiresAt =
    payload.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn;

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: payload.token_type,
    user: payload.user,
  };
}

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  if (!response.ok) {
    const message = data?.error_description || data?.error || "Request failed.";
    throw new Error(message);
  }

  return data;
}

export async function signupWithPassword(email, password, options = {}) {
  const metadata = options?.data;
  const body = { email, password };
  if (metadata && Object.keys(metadata).length > 0) {
    body.data = metadata;
  }

  const response = await supabaseFetch("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const payload = await parseResponse(response);
  return buildSessionPayload(payload);
}

export async function loginWithPassword(email, password) {
  const response = await supabaseFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseResponse(response);
  return buildSessionPayload(payload);
}

export async function refreshSession(refreshToken) {
  const response = await supabaseFetch(
    "/auth/v1/token?grant_type=refresh_token",
    {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  const payload = await parseResponse(response);
  return buildSessionPayload(payload);
}

async function readStoredSession() {
  const { [SESSION_STORAGE_KEY]: session } = await chrome.storage.local.get([
    SESSION_STORAGE_KEY,
  ]);
  return session || null;
}

async function writeStoredSession(session) {
  if (session) {
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
    return;
  }
  await chrome.storage.local.remove([SESSION_STORAGE_KEY]);
}

function notifyAuthStateChange(event, session) {
  for (const callback of authListeners) {
    try {
      callback(event, session);
    } catch (_error) {
      // ignore
    }
  }
}

function createSubscription(callback) {
  authListeners.add(callback);
  return {
    unsubscribe() {
      authListeners.delete(callback);
    },
  };
}

async function setSession(tokens) {
  await writeStoredSession(tokens || null);
  notifyAuthStateChange(tokens ? "SIGNED_IN" : "SIGNED_OUT", tokens || null);
  return { data: { session: tokens || null }, error: null };
}

async function getSession() {
  const session = await readStoredSession();
  return { data: { session }, error: null };
}

function onAuthStateChange(callback) {
  return { data: { subscription: createSubscription(callback) }, error: null };
}

async function signInWithPassword({ email, password }) {
  const session = await loginWithPassword(email, password);
  return setSession(session);
}

async function signUp({ email, password, options }) {
  const session = await signupWithPassword(email, password, options);
  await setSession(session);
  return { data: { session, user: session?.user || null }, error: null };
}

export function createSupabaseAuthClient() {
  return {
    auth: {
      getSession,
      setSession,
      onAuthStateChange,
      signInWithPassword,
      signUp,
      refreshSession,
    },
  };
}
