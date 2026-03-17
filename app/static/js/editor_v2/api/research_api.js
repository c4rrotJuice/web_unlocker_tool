async function authJson(path) {
  const res = await window.webUnlockerAuth.authFetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload?.detail || "Research request failed");
    error.status = res.status;
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
    listProjects() {
      return authJson("/api/projects");
    },
    listTags() {
      return authJson("/api/tags");
    },
  };
}
