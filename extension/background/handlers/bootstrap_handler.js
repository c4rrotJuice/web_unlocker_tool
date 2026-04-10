// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { validateBootstrapSnapshot } from "../../shared/contracts/validators.js";
import { createErrorResult, ERROR_CODES, createOkResult } from "../../shared/types/messages.js";
export function createBootstrapHandler(options = {}) {
    const typedOptions = options;
    const apiClient = typedOptions.apiClient;
    const sessionStore = typedOptions.sessionStore;
    const sessionManager = typedOptions.sessionManager;
    const stateStore = typedOptions.stateStore;
    if (!apiClient || !sessionStore || !stateStore || !sessionManager) {
        throw new Error("createBootstrapHandler requires apiClient, sessionStore, sessionManager, and stateStore.");
    }
    async function fetch(request = { requestId: undefined }, options = {}) {
        const didRetry = options.didRetry === true;
        const previousState = stateStore.getState();
        stateStore.setLoading("bootstrap_fetch", previousState);
        const session = await sessionManager.ensureSession({ reason: "bootstrap_fetch" });
        if (!session?.access_token) {
            const auth = await sessionManager.persistAuthState(stateStore.setSignedOut("missing_session"));
            return createOkResult({ auth }, request.requestId);
        }
        const result = await apiClient.loadBootstrap();
        if (result.ok === false) {
            const code = result.error?.code || ERROR_CODES.BOOTSTRAP_FAILED;
            if (code === ERROR_CODES.UNAUTHORIZED || code === ERROR_CODES.AUTH_INVALID) {
                if (didRetry) {
                    const auth = await sessionManager.persistAuthState(stateStore.setSignedOut("invalid_session"));
                    return createOkResult({ auth }, request.requestId);
                }
                const refreshed = await sessionManager.refreshSession({ reason: "bootstrap_retry", force: true });
                if (refreshed?.access_token) {
                    return fetch(request, { didRetry: true });
                }
                const auth = await sessionManager.persistAuthState(stateStore.setSignedOut("invalid_session"));
                return createOkResult({ auth }, request.requestId);
            }
            const auth = await sessionManager.persistAuthState(stateStore.setError(result.error, "bootstrap_failed", previousState));
            return createErrorResult(code, result.error.message || "Bootstrap failed.", request.requestId, result.error.details ?? null, { auth });
        }
        const validated = validateBootstrapSnapshot(result.data);
        if (validated.ok === false) {
            const auth = await sessionManager.persistAuthState(stateStore.setError(validated.error, "bootstrap_invalid", previousState));
            return createErrorResult(validated.error.code, validated.error.message, request.requestId, validated.error.details ?? null, { auth });
        }
        const auth = await sessionManager.persistAuthState(stateStore.setSignedIn({
            session,
            bootstrap: validated.data,
        }));
        return createOkResult({ auth }, request.requestId);
    }
    return {
        fetch,
    };
}
