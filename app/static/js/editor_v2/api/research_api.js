import { createAuthSessionErrorFromPayload } from "../../shared/auth/session.js";

async function authJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await window.webUnlockerAuth.authFetch(path, {
    method: options.method || "GET",
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const authError = createAuthSessionErrorFromPayload(payload, res.status, path);
    if (authError) {
      throw authError;
    }
    const error = new Error(payload?.detail || "Research request failed");
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload?.data ?? payload;
}

export function createResearchApi() {
  return {
    listSources({ query = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("query", query);
      return authJson(`/api/sources?${params.toString()}`);
    },
    getSource(sourceId) {
      return authJson(`/api/sources/${encodeURIComponent(sourceId)}`);
    },
    listCitations({ search = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (search) params.set("search", search);
      return authJson(`/api/citations?${params.toString()}`);
    },
    getCitation(citationId) {
      return authJson(`/api/citations/${encodeURIComponent(citationId)}`);
    },
    listQuotes({ query = "", documentId = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("query", query);
      if (documentId) params.set("document_id", documentId);
      return authJson(`/api/quotes?${params.toString()}`);
    },
    getQuote(quoteId) {
      return authJson(`/api/quotes/${encodeURIComponent(quoteId)}`);
    },
    listNotes({ query = "", projectId = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("query", query);
      if (projectId) params.set("project_id", projectId);
      return authJson(`/api/notes?${params.toString()}`);
    },
    getNote(noteId) {
      return authJson(`/api/notes/${encodeURIComponent(noteId)}`);
    },
    createNote(payload) {
      return authJson("/api/notes", {
        method: "POST",
        body: payload,
      });
    },
    createNoteFromQuote(quoteId, payload) {
      return authJson(`/api/quotes/${encodeURIComponent(quoteId)}/notes`, {
        method: "POST",
        body: payload,
      });
    },
    listProjects() {
      return authJson("/api/projects");
    },
    listTags() {
      return authJson("/api/tags");
    },
  };
}
