export function createResearchApi() {
  return {
    listSources({ query = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("query", query);
      return window.webUnlockerAuth.authJson(`/api/sources?${params.toString()}`, { method: "GET" });
    },
    getSource(sourceId) {
      return window.webUnlockerAuth.authJson(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "GET" });
    },
    listCitations({ search = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (search) params.set("search", search);
      return window.webUnlockerAuth.authJson(`/api/citations?${params.toString()}`, { method: "GET" });
    },
    getCitation(citationId) {
      return window.webUnlockerAuth.authJson(`/api/citations/${encodeURIComponent(citationId)}`, { method: "GET" });
    },
    listQuotes({ query = "", documentId = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("query", query);
      if (documentId) params.set("document_id", documentId);
      return window.webUnlockerAuth.authJson(`/api/quotes?${params.toString()}`, { method: "GET" });
    },
    getQuote(quoteId) {
      return window.webUnlockerAuth.authJson(`/api/quotes/${encodeURIComponent(quoteId)}`, { method: "GET" });
    },
    listNotes({ query = "", projectId = "", limit = 24 } = {}) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) params.set("query", query);
      if (projectId) params.set("project_id", projectId);
      return window.webUnlockerAuth.authJson(`/api/notes?${params.toString()}`, { method: "GET" });
    },
    getNote(noteId) {
      return window.webUnlockerAuth.authJson(`/api/notes/${encodeURIComponent(noteId)}`, { method: "GET" });
    },
    createNote(payload) {
      return window.webUnlockerAuth.authJson("/api/notes", {
        method: "POST",
        body: payload,
      });
    },
    createNoteFromQuote(quoteId, payload) {
      return window.webUnlockerAuth.authJson(`/api/quotes/${encodeURIComponent(quoteId)}/notes`, {
        method: "POST",
        body: payload,
      });
    },
    listProjects() {
      return window.webUnlockerAuth.authJson("/api/projects", { method: "GET" });
    },
    listTags() {
      return window.webUnlockerAuth.authJson("/api/tags", { method: "GET" });
    },
  };
}
