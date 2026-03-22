// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
export const AUTH_STATUS = Object.freeze({
    LOADING: "loading",
    SIGNED_OUT: "signed_out",
    SIGNED_IN: "signed_in",
    ERROR: "error",
});
export function createLoadingAuthState(reason = "startup") {
    return {
        status: AUTH_STATUS.LOADING,
        reason,
        session: null,
        bootstrap: null,
        error: null,
    };
}
export function createSignedOutAuthState(reason = "signed_out") {
    return {
        status: AUTH_STATUS.SIGNED_OUT,
        reason,
        session: null,
        bootstrap: null,
        error: null,
    };
}
export function createSignedInAuthState({ session, bootstrap }) {
    return {
        status: AUTH_STATUS.SIGNED_IN,
        reason: null,
        session,
        bootstrap,
        error: null,
    };
}
export function createAuthErrorState(error, reason = "auth_error") {
    return {
        status: AUTH_STATUS.ERROR,
        reason,
        session: null,
        bootstrap: null,
        error: normalizeAuthError(error),
    };
}
export function normalizeAuthError(error, fallbackCode = "auth_invalid") {
    if (!error || typeof error !== "object") {
        return {
            code: fallbackCode,
            message: "Authentication failed.",
            details: null,
        };
    }
    return {
        code: typeof error.code === "string" ? error.code : fallbackCode,
        message: typeof error.message === "string" && error.message.trim() ? error.message : "Authentication failed.",
        details: error.details ?? null,
    };
}
export function normalizeSession(session) {
    if (!session || typeof session !== "object" || typeof session.access_token !== "string" || !session.access_token.trim()) {
        return null;
    }
    return {
        access_token: session.access_token,
        refresh_token: typeof session.refresh_token === "string" && session.refresh_token.trim() ? session.refresh_token : null,
        token_type: typeof session.token_type === "string" && session.token_type.trim() ? session.token_type : "bearer",
        user_id: typeof session.user_id === "string" && session.user_id.trim() ? session.user_id : null,
        email: typeof session.email === "string" && session.email.trim() ? session.email : null,
        issued_at: typeof session.issued_at === "string" && session.issued_at.trim() ? session.issued_at : new Date().toISOString(),
        expires_at: typeof session.expires_at === "string" && session.expires_at.trim() ? session.expires_at : null,
        expires_in: Number.isFinite(session.expires_in) ? session.expires_in : null,
        source: typeof session.source === "string" && session.source.trim() ? session.source : "background",
    };
}
