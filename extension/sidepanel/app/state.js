// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
export const SIDEPANEL_TABS = Object.freeze({
    CITATIONS: "citations",
    NOTES: "notes",
    NEW_NOTE: "new-note",
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
export function createSidepanelStateStore(initialState = {}) {
    let state = {
        status: SIDEPANEL_STATUS.LOADING,
        auth: null,
        active_tab: SIDEPANEL_TABS.CITATIONS,
        recent_citations: [],
        recent_notes: [],
        expanded_citation_id: null,
        expanded_note_id: null,
        noteStatus: "closed",
        noteText: "",
        noteError: "",
        pageContext: null,
        notice: null,
        ...clone(initialState),
    };
    function setState(nextState = {}) {
        state = { ...state, ...clone(nextState) };
        return getState();
    }
    function getState() {
        return clone(state);
    }
    return {
        getState,
        setState,
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
        setRecentCitations(recent_citations) {
            return setState({ recent_citations: Array.isArray(recent_citations) ? recent_citations : [] });
        },
        setRecentNotes(recent_notes) {
            return setState({ recent_notes: Array.isArray(recent_notes) ? recent_notes : [] });
        },
        setExpandedCitationId(expanded_citation_id) {
            return setState({ expanded_citation_id, expanded_note_id: null });
        },
        setExpandedNoteId(expanded_note_id) {
            return setState({ expanded_note_id, expanded_citation_id: null });
        },
        setNotice(notice) {
            return setState({ notice });
        },
        clearNotice() {
            return setState({ notice: null });
        },
    };
}
