export const SIDEPANEL_TAB_KEYS = Object.freeze({
  CITATIONS: "citations",
  NOTES: "notes",
  NEW_NOTE: "new_note",
});

export const SIDEPANEL_STATUS = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  SIGNED_OUT: "signed_out",
  ERROR: "error",
});

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createSidepanelViewState(initialState = {}) {
  return {
    status: SIDEPANEL_STATUS.LOADING,
    active_tab: SIDEPANEL_TAB_KEYS.CITATIONS,
    auth: null,
    bootstrap: null,
    recent_citations: [],
    recent_notes: [],
    expanded_citation_id: null,
    expanded_note_id: null,
    loading: {
      auth: true,
      citations: true,
      notes: true,
      action: null,
    },
    error: null,
    notice: null,
    draft_note: {
      title: "",
      body: "",
    },
    page: {
      unlock_status: null,
      current_url: null,
    },
    ...clone(initialState),
  };
}

export function createSidepanelStateStore(initialState = createSidepanelViewState()) {
  let state = clone(initialState);

  function setState(nextState = {}) {
    state = {
      ...state,
      ...clone(nextState),
      loading: {
        ...state.loading,
        ...(nextState.loading || {}),
      },
      draft_note: {
        ...state.draft_note,
        ...(nextState.draft_note || {}),
      },
      page: {
        ...state.page,
        ...(nextState.page || {}),
      },
    };
    return getState();
  }

  function getState() {
    return clone(state);
  }

  return {
    getState,
    setState,
    setStatus(status, error = null) {
      return setState({ status, error });
    },
    setAuth(auth) {
      return setState({
        auth,
        bootstrap: auth?.bootstrap || null,
        status: auth?.status === "signed_out" ? SIDEPANEL_STATUS.SIGNED_OUT : auth?.status === "error" ? SIDEPANEL_STATUS.ERROR : SIDEPANEL_STATUS.READY,
        loading: { auth: false },
        error: auth?.error || null,
      });
    },
    setBootstrap(bootstrap) {
      return setState({ bootstrap });
    },
    setActiveTab(active_tab) {
      return setState({ active_tab });
    },
    setRecentCitations(recent_citations) {
      return setState({ recent_citations: Array.isArray(recent_citations) ? recent_citations : [], loading: { citations: false } });
    },
    setRecentNotes(recent_notes) {
      return setState({ recent_notes: Array.isArray(recent_notes) ? recent_notes : [], loading: { notes: false } });
    },
    setExpandedCitationId(expanded_citation_id) {
      return setState({ expanded_citation_id, expanded_note_id: null });
    },
    setExpandedNoteId(expanded_note_id) {
      return setState({ expanded_note_id, expanded_citation_id: null });
    },
    setDraftNote(draft_note) {
      return setState({ draft_note });
    },
    setLoading(nextLoading = {}) {
      return setState({ loading: { ...state.loading, ...nextLoading } });
    },
    setError(error) {
      return setState({ status: SIDEPANEL_STATUS.ERROR, error, loading: { auth: false, citations: false, notes: false } });
    },
    clearError() {
      return setState({ error: null, status: state.auth?.status === "signed_out" ? SIDEPANEL_STATUS.SIGNED_OUT : SIDEPANEL_STATUS.READY });
    },
    setNotice(notice) {
      return setState({ notice });
    },
    clearNotice() {
      return setState({ notice: null });
    },
  };
}
