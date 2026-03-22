// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { validateBootstrapSnapshot } from "../../shared/contracts/validators.js";
import { createErrorResult, ERROR_CODES, createOkResult } from "../../shared/types/messages.js";
export function createBootstrapHandler(options = {}) {
    const typedOptions = options;
    const apiClient = typedOptions.apiClient;
    const sessionStore = typedOptions.sessionStore;
    const stateStore = typedOptions.stateStore;
    if (!apiClient || !sessionStore || !stateStore) {
        throw new Error("createBootstrapHandler requires apiClient, sessionStore, and stateStore.");
    }
    async function fetch(request = { requestId: undefined }) {
        stateStore.setLoading("bootstrap_fetch");
        const session = await sessionStore.read();
        if (!session?.access_token) {
            const auth = stateStore.setSignedOut("missing_session");
            return createOkResult({ auth }, request.requestId);
        }
        const result = await apiClient.loadBootstrap();
        if (result.ok === false) {
            const code = result.error?.code || ERROR_CODES.BOOTSTRAP_FAILED;
            if (code === ERROR_CODES.UNAUTHORIZED || code === ERROR_CODES.AUTH_INVALID) {
                await sessionStore.clear();
                const auth = stateStore.setSignedOut("invalid_session");
                return createOkResult({ auth }, request.requestId);
            }
            const auth = stateStore.setError(result.error, "bootstrap_failed");
            return createErrorResult(code, result.error.message || "Bootstrap failed.", request.requestId, result.error.details ?? null, { auth });
        }
        const validated = validateBootstrapSnapshot(result.data);
        if (validated.ok === false) {
            const auth = stateStore.setError(validated.error, "bootstrap_invalid");
            return createErrorResult(validated.error.code, validated.error.message, request.requestId, validated.error.details ?? null, { auth });
        }
        const auth = stateStore.setSignedIn({
            session,
            bootstrap: validated.data,
        });
        return createOkResult({ auth }, request.requestId);
    }
    return {
        fetch,
    };
}
