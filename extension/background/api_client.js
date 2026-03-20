import { BACKEND_BASE_URL } from "../config.js";
import { createLogger } from "../shared/log.js";

const logger = createLogger("background:api");
const ANON_USAGE_HEADER = "X-Extension-Anon-Id";
const ANON_USAGE_ID_KEY = "anon_usage_id";

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (value || "").trim(),
  );
}

async function getOrCreateAnonUsageId() {
  const payload = await chrome.storage.local.get({ [ANON_USAGE_ID_KEY]: null });
  if (isValidUuid(payload[ANON_USAGE_ID_KEY])) {
    return payload[ANON_USAGE_ID_KEY];
  }
  const nextId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000";
  await chrome.storage.local.set({ [ANON_USAGE_ID_KEY]: nextId });
  return nextId;
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createApiClient({ sessionManager }) {
  async function request(path, options = {}, authMode = "optional") {
    const headers = new Headers(options.headers || {});
    headers.set("Content-Type", "application/json");
    headers.set("X-Client", "extension");
    headers.set(ANON_USAGE_HEADER, await getOrCreateAnonUsageId());

    let session = null;
    if (authMode !== "none") {
      session = await sessionManager.ensureSession({ allowMissing: authMode === "optional" });
      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
    }

    const response = await fetch(`${BACKEND_BASE_URL}${path}`, { ...options, headers });
    const payload = await parseJson(response);
    if (response.status === 401) {
      await sessionManager.handleUnauthorized();
    }
    if (!response.ok) {
      const error = new Error(payload?.detail || payload?.error || payload?.message || "request_failed");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return {
    async bootstrap() {
      return request("/api/extension/bootstrap", { method: "GET" }, "required");
    },
    async recentTaxonomy() {
      return request("/api/extension/taxonomy/recent", { method: "GET" }, "required");
    },
    async captureCitation(payload, { idempotencyKey } = {}) {
      return request("/api/extension/captures/citation", {
        method: "POST",
        headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify(payload),
      }, "required");
    },
    async captureQuote(payload, { idempotencyKey } = {}) {
      return request("/api/extension/captures/quote", {
        method: "POST",
        headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify(payload),
      }, "required");
    },
    async captureNote(payload, { idempotencyKey } = {}) {
      return request("/api/extension/captures/note", {
        method: "POST",
        headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify(payload),
      }, "required");
    },
    async updateNote(noteId, payload, { idempotencyKey } = {}) {
      return request(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: "PATCH",
        headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify(payload),
      }, "required");
    },
    async deleteNote(noteId) {
      return request(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      }, "required");
    },
    async workInEditor(payload, { idempotencyKey } = {}) {
      return request("/api/extension/work-in-editor", {
        method: "POST",
        headers: idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {},
        body: JSON.stringify(payload),
      }, "required");
    },
    async usageEvent(payload) {
      return request("/api/extension/usage-events", {
        method: "POST",
        body: JSON.stringify(payload),
      }, "required");
    },
    async issueHandoff(payload) {
      return request("/api/auth/handoff", {
        method: "POST",
        body: JSON.stringify(payload),
      }, "required");
    },
    async exchangeHandoff(payload) {
      logger.info("Exchanging auth restore handoff");
      return request("/api/auth/handoff/exchange", {
        method: "POST",
        body: JSON.stringify(payload),
      }, "none");
    },
  };
}
