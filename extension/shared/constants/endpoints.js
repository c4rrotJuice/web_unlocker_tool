export const API_ORIGIN = "https://app.writior.com";
export const ENDPOINTS = Object.freeze({
    BOOTSTRAP: "/api/extension/bootstrap",
    WORK_IN_EDITOR: "/api/extension/work-in-editor",
    CITATIONS: "/api/citations",
    NOTES: "/api/notes",
    CAPTURE_CITATION: "/api/extension/captures/citation",
    CAPTURE_QUOTE: "/api/extension/captures/quote",
    CAPTURE_NOTE: "/api/extension/captures/note",
    CITATION_RENDER: "/api/citations/render",
    AUTH_HANDOFF: "/api/auth/handoff",
    AUTH_HANDOFF_EXCHANGE: "/api/auth/handoff/exchange",
    AUTH_HANDOFF_ATTEMPTS: "/api/auth/handoff/attempts",
    AUTH_HANDOFF_ATTEMPT_STATUS: "/api/auth/handoff/attempts/{attempt_id}",
    AUTH_PAGE: "/auth",
});
