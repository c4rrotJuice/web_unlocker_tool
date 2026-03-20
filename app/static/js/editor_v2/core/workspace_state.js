function cloneEntity(entity) {
  return entity ? { ...entity } : null;
}

const initialState = () => ({
  document_list: [],
  active_document_id: null,
  active_document: null,
  dirty: false,
  save_status: "saved",
  attached_relation_ids: { citations: [], notes: [], tags: [] },
  attached_research: { citations: [], notes: [], quotes: [], sources: [] },
  active_project_id: null,
  seed_state: null,
  hydration: {
    document_ready: false,
    attached_ready: false,
    explorer_by_type: {},
    detail_by_key: {},
  },
  runtime_failures: {
    document_transition: null,
    document_hydrate: null,
    explorer_by_type: {},
    checkpoints: null,
  },
  runtime_activity: {
    save: { phase: "idle", sequence: 0, message: null },
    flush: { phase: "idle", sequence: 0, message: null },
    document_transition: { phase: "idle", sequence: 0, message: null },
    hydrate: { phase: "idle", sequence: 0, message: null },
    explorer_by_type: {},
    checkpoints: { phase: "idle", sequence: 0, message: null },
  },
  pending_explorer_action: null,
  focused_entity: null,
});

export function createWorkspaceState() {
  let state = initialState();
  const listeners = new Set();

  function upsertDocumentList(document) {
    if (!document?.id) return state.document_list;
    const next = state.document_list.filter((item) => item.id !== document.id);
    next.unshift({
      id: document.id,
      title: document.title,
      project_id: document.project_id || null,
      status: document.status || "active",
      archived: !!document.archived,
      attached_citation_ids: (document.attached_citation_ids || []).slice(),
      attached_note_ids: (document.attached_note_ids || []).slice(),
      tag_ids: (document.tag_ids || []).slice(),
      tags: (document.tags || []).slice(),
      created_at: document.created_at,
      updated_at: document.updated_at,
    });
    return next;
  }

  function notify() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function set(partial) {
    state = {
      ...state,
      ...partial,
    };
    notify();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
    resetForEmptyEntry(seedState = null) {
      const existingList = state.document_list;
      state = initialState();
      state.document_list = existingList;
      state.seed_state = seedState ? { ...seedState } : null;
      notify();
    },
    setDocumentList(documents) {
      set({ document_list: Array.isArray(documents) ? documents.slice() : [] });
    },
    setSeedState(seedState) {
      set({ seed_state: seedState ? { ...seedState } : null });
    },
    setDocument(document) {
      const attached = {
        citations: (document?.attached_citation_ids || []).slice(),
        notes: (document?.attached_note_ids || []).slice(),
        tags: (document?.tag_ids || []).slice(),
      };
      set({
        active_document_id: document?.id || null,
        active_document: document ? { ...document } : null,
        dirty: false,
        save_status: "saved",
        active_project_id: document?.project_id || null,
        attached_relation_ids: attached,
        attached_research: { citations: [], notes: [], quotes: [], sources: [] },
        document_list: document ? upsertDocumentList(document) : state.document_list,
        hydration: {
          ...state.hydration,
          document_ready: !!document,
          attached_ready: false,
        },
        runtime_failures: {
          ...state.runtime_failures,
          document_transition: null,
          document_hydrate: null,
          checkpoints: null,
        },
      });
    },
    patchDocument(patch) {
      if (!state.active_document) return;
      set({
        active_document: {
          ...state.active_document,
          ...patch,
        },
      });
    },
    markDirty(patch = {}) {
      if (!state.active_document) return;
      set({
        active_document: {
          ...state.active_document,
          ...patch,
        },
        dirty: true,
      });
    },
    setSaveStatus(status) {
      set({ save_status: status });
    },
    markSavedFromServer(document) {
      const nextDocument = document ? { ...document } : cloneEntity(state.active_document);
      const attached = {
        citations: (nextDocument?.attached_citation_ids || []).slice(),
        notes: (nextDocument?.attached_note_ids || []).slice(),
        tags: (nextDocument?.tag_ids || []).slice(),
      };
      set({
        active_document: nextDocument,
        dirty: false,
        save_status: "saved",
        active_project_id: nextDocument?.project_id || null,
        attached_relation_ids: attached,
        document_list: nextDocument ? upsertDocumentList(nextDocument) : state.document_list,
      });
    },
    setAttachedRelationIds(kind, ids) {
      set({
        attached_relation_ids: {
          ...state.attached_relation_ids,
          [kind]: Array.isArray(ids) ? Array.from(new Set(ids)) : [],
        },
      });
    },
    setAttachedResearch(payload = {}) {
      set({
        attached_research: {
          citations: Array.isArray(payload.citations) ? payload.citations.slice() : [],
          notes: Array.isArray(payload.notes) ? payload.notes.slice() : [],
          quotes: Array.isArray(payload.quotes) ? payload.quotes.slice() : [],
          sources: Array.isArray(payload.sources) ? payload.sources.slice() : [],
        },
      });
    },
    setHydrationFlag(key, value) {
      set({
        hydration: {
          ...state.hydration,
          [key]: value,
        },
      });
    },
    setExplorerHydrated(type, value) {
      if (state.hydration.explorer_by_type[type] === value) return;
      set({
        hydration: {
          ...state.hydration,
          explorer_by_type: {
            ...state.hydration.explorer_by_type,
            [type]: value,
          },
        },
      });
    },
    setDetailHydrated(key, value) {
      if (state.hydration.detail_by_key[key] === value) return;
      set({
        hydration: {
          ...state.hydration,
          detail_by_key: {
            ...state.hydration.detail_by_key,
            [key]: value,
          },
        },
      });
    },
    setFocusedEntity(entity) {
      set({ focused_entity: entity ? { ...entity } : null });
    },
    setSaveActivity(activity) {
      set({
        runtime_activity: {
          ...state.runtime_activity,
          save: {
            ...state.runtime_activity.save,
            ...activity,
          },
        },
      });
    },
    setFlushActivity(activity) {
      set({
        runtime_activity: {
          ...state.runtime_activity,
          flush: {
            ...state.runtime_activity.flush,
            ...activity,
          },
        },
      });
    },
    setDocumentTransitionActivity(activity) {
      set({
        runtime_activity: {
          ...state.runtime_activity,
          document_transition: {
            ...state.runtime_activity.document_transition,
            ...activity,
          },
        },
      });
    },
    setHydrateActivity(activity) {
      set({
        runtime_activity: {
          ...state.runtime_activity,
          hydrate: {
            ...state.runtime_activity.hydrate,
            ...activity,
          },
        },
      });
    },
    setExplorerActivity(type, activity) {
      set({
        runtime_activity: {
          ...state.runtime_activity,
          explorer_by_type: {
            ...state.runtime_activity.explorer_by_type,
            [type]: {
              ...(state.runtime_activity.explorer_by_type[type] || { phase: "idle", sequence: 0, message: null }),
              ...activity,
            },
          },
        },
      });
    },
    setCheckpointActivity(activity) {
      set({
        runtime_activity: {
          ...state.runtime_activity,
          checkpoints: {
            ...state.runtime_activity.checkpoints,
            ...activity,
          },
        },
      });
    },
    setDocumentTransitionFailure(failure) {
      set({
        runtime_failures: {
          ...state.runtime_failures,
          document_transition: failure ? { ...failure } : null,
        },
      });
    },
    setDocumentHydrateFailure(failure) {
      set({
        runtime_failures: {
          ...state.runtime_failures,
          document_hydrate: failure ? { ...failure } : null,
        },
      });
    },
    setExplorerFailure(type, failure) {
      set({
        runtime_failures: {
          ...state.runtime_failures,
          explorer_by_type: {
            ...state.runtime_failures.explorer_by_type,
            [type]: failure ? { ...failure } : null,
          },
        },
      });
    },
    setCheckpointFailure(failure) {
      set({
        runtime_failures: {
          ...state.runtime_failures,
          checkpoints: failure ? { ...failure } : null,
        },
      });
    },
    setPendingExplorerAction(action) {
      set({
        pending_explorer_action: action ? { ...action } : null,
      });
    },
  };
}
