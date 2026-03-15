(function attachNotesStoreRuntime(global) {
  const runtime = global.WritiorEditorRuntime;
  if (!runtime || typeof runtime.register !== "function") {
    throw new Error("[editor] Runtime core must load before notes store runtime");
  }

  function createNotesStore() {
    const state = {
      entities: new Map(),
      orderedIds: [],
      query: { tag: "", project: "", source: "", search: "", sort: "desc" },
      loadState: { loaded: false, loading: false },
    };

    function setQuery(next) {
      state.query = { ...state.query, ...(next || {}) };
    }

    function replaceAll(notes) {
      state.entities.clear();
      state.orderedIds = [];
      (notes || []).forEach((note) => {
        if (!note?.id) return;
        state.entities.set(note.id, note);
        state.orderedIds.push(note.id);
      });
      state.loadState.loaded = true;
      state.loadState.loading = false;
    }

    function getAll() {
      return state.orderedIds.map((id) => state.entities.get(id)).filter(Boolean);
    }

    function getById(id) {
      return state.entities.get(id) || null;
    }

    function selectVisibleNotes() {
      return getAll();
    }

    function selectResearchNotes(currentDocProjectIds, search) {
      const q = String(search || "").trim().toLowerCase();
      const projectIds = currentDocProjectIds || new Set();
      return getAll().filter((note) => {
        if (note.archived_at) return false;
        const text = `${note.title || ""} ${note.highlight_text || ""} ${note.note_body || ""} ${note.source_title || ""}`.toLowerCase();
        const matchesText = !q || text.includes(q);
        const matchesProject = !projectIds.size || projectIds.has(note.project_id);
        return matchesText && matchesProject;
      });
    }

    function selectAttachableNotes(search) {
      const q = String(search || "").trim().toLowerCase();
      return getAll().filter((note) => {
        if (note.archived_at) return false;
        const text = `${note.title || ""} ${note.highlight_text || ""} ${note.note_body || ""} ${note.source_title || ""}`.toLowerCase();
        return !q || text.includes(q);
      });
    }

    function selectQuickLinkNotes(search) {
      const q = String(search || "").trim().toLowerCase();
      return getAll().filter((note) => {
        const text = `${note.title || ""} ${note.note_body || ""} ${note.highlight_text || ""}`.toLowerCase();
        return !q || text.includes(q);
      });
    }

    return {
      state,
      setQuery,
      replaceAll,
      getAll,
      getById,
      selectVisibleNotes,
      selectResearchNotes,
      selectAttachableNotes,
      selectQuickLinkNotes,
    };
  }

  runtime.register("notesStore", createNotesStore);
})(window);
