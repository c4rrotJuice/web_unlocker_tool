export const SIDEPANEL_TABS = Object.freeze({
  CITATIONS: "citations",
  NOTES: "notes",
  DOCS: "docs",
  NEW_NOTE: "new-note",
  QUOTES: "quotes",
});

export const SIDEPANEL_STATUS = Object.freeze({
  LOADING: "loading",
  READY: "ready",
  SIGNED_OUT: "signed_out",
  ERROR: "error",
});

export const TAB_LOAD_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error",
  GATED: "gated",
  UNAVAILABLE: "unavailable",
});

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function createTabState(status: string = TAB_LOAD_STATUS.IDLE, items = [], message = "") {
  return { status, items, message };
}

export function createSidepanelStateStore(initialState = {}) {
  let state = {
    status: SIDEPANEL_STATUS.LOADING,
    auth: null,
    active_tab: SIDEPANEL_TABS.CITATIONS,
    tabs: {
      [SIDEPANEL_TABS.CITATIONS]: createTabState(),
      [SIDEPANEL_TABS.NOTES]: createTabState(),
      [SIDEPANEL_TABS.DOCS]: createTabState(TAB_LOAD_STATUS.UNAVAILABLE, [], "Documents are opened through the canonical editor flow."),
      [SIDEPANEL_TABS.NEW_NOTE]: createTabState(TAB_LOAD_STATUS.READY),
      [SIDEPANEL_TABS.QUOTES]: createTabState(TAB_LOAD_STATUS.UNAVAILABLE, [], "Quotes list hydration is not available from the current extension contract."),
    },
    noteStatus: "closed",
    noteText: "",
    noteError: "",
    pageContext: null,
    notice: null,
    ...clone(initialState),
  };

  function getState() {
    return clone(state);
  }

  function setState(nextState = {}) {
    state = { ...state, ...clone(nextState) };
    return getState();
  }

  function updateTab(tabKey, patch = {}) {
    return setState({
      tabs: {
        ...state.tabs,
        [tabKey]: {
          ...(state.tabs?.[tabKey] || createTabState()),
          ...clone(patch),
        },
      },
    });
  }

  return {
    getState,
    setState,
    updateTab,
    resetSignedOutTabs() {
      return setState({
        tabs: {
          ...state.tabs,
          [SIDEPANEL_TABS.CITATIONS]: createTabState(TAB_LOAD_STATUS.GATED, [], "Sign in to review recent citations."),
          [SIDEPANEL_TABS.NOTES]: createTabState(TAB_LOAD_STATUS.GATED, [], "Sign in to review recent notes."),
          [SIDEPANEL_TABS.DOCS]: createTabState(TAB_LOAD_STATUS.GATED, [], "Sign in to open recent documents."),
          [SIDEPANEL_TABS.NEW_NOTE]: createTabState(TAB_LOAD_STATUS.GATED, [], "Sign in to save notes into the canonical workspace."),
          [SIDEPANEL_TABS.QUOTES]: createTabState(TAB_LOAD_STATUS.GATED, [], "Sign in to review captured quotes."),
        },
      });
    },
    setAuth(auth) {
      return setState({
        auth,
        status: auth?.status === "signed_in"
          ? SIDEPANEL_STATUS.READY
          : auth?.status === "refreshing"
            ? SIDEPANEL_STATUS.LOADING
            : auth?.status === "signed_out"
              ? SIDEPANEL_STATUS.SIGNED_OUT
              : auth?.status === "error"
                ? SIDEPANEL_STATUS.ERROR
                : SIDEPANEL_STATUS.LOADING,
      });
    },
    setActiveTab(active_tab) {
      return setState({ active_tab });
    },
    setNotice(notice) {
      return setState({ notice });
    },
    clearNotice() {
      return setState({ notice: null });
    },
  };
}
