// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
export const AUTH_STATUS = Object.freeze({
    LOADING: "loading",
    SIGNED_OUT: "signed_out",
    SIGNED_IN: "signed_in",
    REFRESHING: "refreshing",
    ERROR: "error",
});
export function createLoadingAuthState(reason = "startup", baseline = {}) {
    return {
        status: AUTH_STATUS.LOADING,
        reason,
        session: normalizeSession(baseline?.session),
        bootstrap: baseline?.bootstrap ?? null,
        error: baseline?.error ?? null,
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
export function createRefreshingAuthState({ reason = "refreshing", session = null, bootstrap = null, } = {}) {
    return {
        status: AUTH_STATUS.REFRESHING,
        reason,
        session,
        bootstrap,
        error: null,
    };
}
export function createAuthErrorState(error, reason = "auth_error", baseline = {}) {
    return {
        status: AUTH_STATUS.ERROR,
        reason,
        session: normalizeSession(baseline?.session),
        bootstrap: baseline?.bootstrap ?? null,
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
    const issuedAt = typeof session.issued_at === "string" && session.issued_at.trim() ? session.issued_at : new Date().toISOString();
    const expiresIn = Number.isFinite(session.expires_in) ? session.expires_in : null;
    const expiresAt = typeof session.expires_at === "string" && session.expires_at.trim()
        ? session.expires_at
        : deriveExpiresAt(issuedAt, expiresIn);
    return {
        access_token: session.access_token,
        refresh_token: typeof session.refresh_token === "string" && session.refresh_token.trim() ? session.refresh_token : null,
        token_type: typeof session.token_type === "string" && session.token_type.trim() ? session.token_type : "bearer",
        user_id: typeof session.user_id === "string" && session.user_id.trim() ? session.user_id : null,
        email: typeof session.email === "string" && session.email.trim() ? session.email : null,
        issued_at: issuedAt,
        expires_at: expiresAt,
        expires_in: expiresIn,
        source: typeof session.source === "string" && session.source.trim() ? session.source : "background",
    };
}
export function getSessionExpiryTime(session) {
    const normalized = normalizeSession(session);
    if (!normalized?.expires_at) {
        return null;
    }
    const expiryTime = Date.parse(normalized.expires_at);
    return Number.isFinite(expiryTime) ? expiryTime : null;
}
export function isSessionExpired(session, now = Date.now()) {
    const expiryTime = getSessionExpiryTime(session);
    return expiryTime !== null ? expiryTime <= now : false;
}
export function hasAuthSession(authState) {
    return Boolean(normalizeSession(authState?.session));
}
export function shouldPresentSignedInUi(authState) {
    if (authState?.status === AUTH_STATUS.SIGNED_IN || authState?.status === AUTH_STATUS.REFRESHING) {
        return true;
    }
    if ((authState?.status === AUTH_STATUS.LOADING || authState?.status === AUTH_STATUS.ERROR) && hasAuthSession(authState)) {
        return true;
    }
    return false;
}
function deriveExpiresAt(issuedAt, expiresIn) {
    if (!Number.isFinite(expiresIn) || expiresIn === null) {
        return null;
    }
    const issuedTime = Date.parse(issuedAt);
    if (!Number.isFinite(issuedTime)) {
        return null;
    }
    return new Date(issuedTime + (expiresIn * 1000)).toISOString();
}
