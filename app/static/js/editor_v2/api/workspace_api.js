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
      return window.webUnlockerAuth.authJson("/api/docs?view=summary", { method: "GET" });
    },
    createDocument(payload = {}) {
      return window.webUnlockerAuth.authJson("/api/docs", {
        method: "POST",
        body: payload,
      });
    },
    getDocument(documentId) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}`, { method: "GET" });
    },
    hydrateDocument(documentId, seed) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/hydrate${buildHydrateQuery(seed)}`, { method: "GET" });
    },
    updateDocument(documentId, payload) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}`, {
        method: "PATCH",
        body: payload,
      });
    },
    replaceDocumentCitations(documentId, citationIds) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/citations`, {
        method: "PUT",
        body: { citation_ids: citationIds },
      });
    },
    replaceDocumentNotes(documentId, noteIds) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/notes`, {
        method: "PUT",
        body: { note_ids: noteIds },
      });
    },
    listCheckpoints(documentId) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints`, { method: "GET" });
    },
    createCheckpoint(documentId, label = null) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints`, {
        method: "POST",
        body: { label },
      });
    },
    restoreCheckpoint(documentId, checkpointId) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore`, {
        method: "POST",
      });
    },
    getOutline(documentId) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/outline`, { method: "GET" });
    },
  };
}
