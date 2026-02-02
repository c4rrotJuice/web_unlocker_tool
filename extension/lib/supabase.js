import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";

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

export async function signupWithPassword(email, password) {
  const response = await supabaseFetch("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
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
