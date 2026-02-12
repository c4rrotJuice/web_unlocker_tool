import { BACKEND_BASE_URL } from "../config.js";

const ANON_USAGE_HEADER = "X-Extension-Anon-Id";
const ANON_USAGE_ID_KEY = "anon_usage_id";

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value || "").trim(),
  );
}

async function getOrCreateAnonUsageId() {
  try {
    const { [ANON_USAGE_ID_KEY]: existing } = await chrome.storage.local.get([ANON_USAGE_ID_KEY]);
    if (isValidUuid(existing)) {
      return existing;
    }
  } catch (error) {
    // ignore and generate below
  }

  const nextId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : null;

  if (nextId) {
    try {
      await chrome.storage.local.set({ [ANON_USAGE_ID_KEY]: nextId });
    } catch (error) {
      // ignore
    }
    return nextId;
  }

  return "00000000-0000-4000-8000-000000000000";
}

export async function apiFetch(path, options = {}, accessToken) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Client", "extension");
  headers.set(ANON_USAGE_HEADER, await getOrCreateAnonUsageId());
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${BACKEND_BASE_URL}${path}`, {
    ...options,
    headers,
  });
}
