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
    replaceDocumentCitations(documentId, revision, citationIds) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/citations`, {
        method: "PUT",
        body: { revision, citation_ids: citationIds },
      });
    },
    replaceDocumentNotes(documentId, revision, noteIds) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/notes`, {
        method: "PUT",
        body: { revision, note_ids: noteIds },
      });
    },
    replaceDocumentTags(documentId, revision, tagIds) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/tags`, {
        method: "PUT",
        body: { revision, tag_ids: tagIds },
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
    restoreCheckpoint(documentId, checkpointId, revision) {
      const params = new URLSearchParams();
      params.set("revision", revision);
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/checkpoints/${encodeURIComponent(checkpointId)}/restore?${params.toString()}`, {
        method: "POST",
      });
    },
    getOutline(documentId) {
      return window.webUnlockerAuth.authJson(`/api/docs/${encodeURIComponent(documentId)}/outline`, { method: "GET" });
    },
  };
}
