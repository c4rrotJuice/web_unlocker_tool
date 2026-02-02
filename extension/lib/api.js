import { BACKEND_BASE_URL } from "../config.js";

export function apiFetch(path, options = {}, accessToken) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Client", "extension");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${BACKEND_BASE_URL}${path}`, {
    ...options,
    headers,
  });
}
