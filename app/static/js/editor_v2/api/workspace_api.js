import { createAuthSessionErrorFromPayload } from "../../shared/auth/session.js";

async function authJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await window.webUnlockerAuth.authFetch(path, {
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
    const error = new Error(payload?.detail || payload?.error?.message || "Workspace request failed");
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload?.data ?? payload;
}

function buildHydrateQuery(seed) {
  if (!seed) return "";
  const params = new URLSearchParams();
  if (seed.source_id) params.set("seed_source_id", seed.source_id);
  if (seed.citation_id) params.set("seed_citation_id", seed.citation_id);
  if (seed.quote_id) params.set("seed_quote_id", seed.quote_id);
  if (seed.note_id) params.set("seed_note_id", seed.note_id);
  if (seed.mode) params.set("seed_mode", seed.mode);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function createWorkspaceApi() {
  return {
    listDocumentsSummary() {
      return authJson("/api/docs?view=summary");
    },
    createDocument(payload = {}) {
      return authJson("/api/docs", {
        method: "POST",
        body: payload,
      });
    },
    getDocument(documentId) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}`);
    },
    hydrateDocument(documentId, seed) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/hydrate${buildHydrateQuery(seed)}`);
    },
    updateDocument(documentId, payload) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}`, {
        method: "PATCH",
        body: payload,
      });
    },
    replaceDocumentCitations(documentId, citationIds) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/citations`, {
        method: "PUT",
        body: { citation_ids: citationIds },
      });
    },
    replaceDocumentNotes(documentId, noteIds) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/notes`, {
        method: "PUT",
        body: { note_ids: noteIds },
      });
    },
    listCheckpoints(documentId) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints`);
    },
    createCheckpoint(documentId, label = null) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints`, {
        method: "POST",
        body: { label },
      });
    },
    restoreCheckpoint(documentId, checkpointId) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`, {
        method: "POST",
      });
    },
    getOutline(documentId) {
      return authJson(`/api/docs/${encodeURIComponent(documentId)}/outline`);
    },
  };
}
