// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { ERROR_CODES } from "../../shared/types/messages.js";
import { isSessionExpired, normalizeSession } from "../../shared/types/auth.js";
const AUTH_REFRESH_ALARM = "writior.auth.refresh";
function isAuthFailure(code = "") {
    return code === ERROR_CODES.UNAUTHORIZED
        || code === ERROR_CODES.AUTH_INVALID
        || code === ERROR_CODES.HANDOFF_REFRESH_FAILED;
}
export function createSessionManager(options = {}) {
    const { apiClient, sessionStore, stateStore, authStateStorage, chromeApi = globalThis.chrome, refreshLeadMs = 60_000, retryDelayMs = 15_000, } = options;
    if (!apiClient || !sessionStore || !stateStore || !authStateStorage) {
        throw new Error("createSessionManager requires apiClient, sessionStore, stateStore, and authStateStorage.");
    }
    let refreshInFlight = null;
    async function persistAuthState(authState = stateStore.getState()) {
        await authStateStorage.write(authState);
        await scheduleRefreshForSession(authState?.session || null);
        return authState;
    }
    async function clearSession(reason = "signed_out") {
        await sessionStore.clear();
        await clearRefreshAlarm();
        return persistAuthState(stateStore.setSignedOut(reason));
    }
    async function scheduleRefreshForSession(session) {
        const alarms = chromeApi?.alarms;
        if (!alarms?.create) {
            return;
        }
        const normalized = normalizeSession(session);
        if (!normalized?.expires_at) {
            await clearRefreshAlarm();
            return;
        }
        const when = Date.parse(normalized.expires_at) - refreshLeadMs;
        if (!Number.isFinite(when)) {
            await clearRefreshAlarm();
            return;
        }
        alarms.create(AUTH_REFRESH_ALARM, { when: Math.max(Date.now() + 1_000, when) });
    }
    async function scheduleRefreshRetry() {
        const alarms = chromeApi?.alarms;
        if (!alarms?.create) {
            return;
        }
        alarms.create(AUTH_REFRESH_ALARM, { when: Date.now() + retryDelayMs });
    }
    async function clearRefreshAlarm() {
        await chromeApi?.alarms?.clear?.(AUTH_REFRESH_ALARM);
    }
    function shouldRefreshSession(session, now = Date.now()) {
        const normalized = normalizeSession(session);
        if (!normalized?.refresh_token || !normalized?.expires_at) {
            return false;
        }
        const expiryTime = Date.parse(normalized.expires_at);
        if (!Number.isFinite(expiryTime)) {
            return false;
        }
        return expiryTime - now <= refreshLeadMs;
    }
    async function refreshSession({ reason = "refreshing", requestId = undefined, force = false } = {}) {
        if (refreshInFlight) {
            return refreshInFlight;
        }
        refreshInFlight = (async () => {
            const currentSession = await sessionStore.read();
            if (!currentSession?.access_token && !currentSession?.refresh_token) {
                await clearSession("missing_session");
                return null;
            }
            if (!force && !shouldRefreshSession(currentSession) && !isSessionExpired(currentSession)) {
                await scheduleRefreshForSession(currentSession);
                return currentSession;
            }
            const previousState = stateStore.getState();
            await persistAuthState(stateStore.setRefreshing(reason, previousState));
            const result = await apiClient.refreshSession({
                refresh_token: currentSession?.refresh_token,
            });
            if (result?.ok === false) {
                if (isAuthFailure(result.error?.code) || isSessionExpired(currentSession)) {
                    await clearSession("refresh_failed");
                    return null;
                }
                await persistAuthState(previousState);
                await scheduleRefreshRetry();
                return currentSession;
            }
            const refreshedSession = normalizeSession({
                ...result.data?.session,
                user_id: result.data?.session?.user_id || currentSession?.user_id || null,
                email: result.data?.session?.email || currentSession?.email || null,
                source: "handoff_refresh",
            });
            if (!refreshedSession?.access_token) {
                await clearSession("refresh_failed");
                return null;
            }
            await sessionStore.write(refreshedSession);
            await persistAuthState(stateStore.setSignedIn({
                session: refreshedSession,
                bootstrap: previousState?.bootstrap || null,
            }));
            return refreshedSession;
        })().finally(() => {
            refreshInFlight = null;
        });
        return refreshInFlight;
    }
    async function ensureSession({ reason = "ensure_session", forceRefresh = false } = {}) {
        const session = await sessionStore.read();
        if (!session?.access_token) {
            await clearSession("missing_session");
            return null;
        }
        if (forceRefresh || shouldRefreshSession(session) || isSessionExpired(session)) {
            return refreshSession({ reason, force: true });
        }
        await scheduleRefreshForSession(session);
        return session;
    }
    return {
        alarmName: AUTH_REFRESH_ALARM,
        persistAuthState,
        clearSession,
        ensureSession,
        refreshSession,
        async getAccessToken() {
            const session = await ensureSession({ reason: "access_token" });
            return session?.access_token || null;
        },
        async refreshAccessToken() {
            const session = await refreshSession({ reason: "request_retry", force: true });
            return session?.access_token || null;
        },
        async onAlarm(alarm) {
            if (alarm?.name !== AUTH_REFRESH_ALARM) {
                return false;
            }
            await refreshSession({ reason: "alarm_refresh", force: true });
            return true;
        },
        async hydratePersistedAuthState() {
            const persisted = await authStateStorage.read();
            if (persisted && stateStore.getState().status === "loading") {
                stateStore.setState(persisted);
            }
            return persisted;
        },
        async bootstrapAuthState() {
            await this.hydratePersistedAuthState();
            await persistAuthState(stateStore.getState());
            return stateStore.getState();
        },
    };
}
