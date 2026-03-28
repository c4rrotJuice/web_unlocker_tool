import { validateBootstrapSnapshot } from "../../shared/contracts/validators.ts";
import { createErrorResult, ERROR_CODES, createOkResult } from "../../shared/types/messages.ts";

export function createBootstrapHandler(options = {}) {
  const typedOptions: any = options;
  const apiClient = typedOptions.apiClient;
  const sessionStore = typedOptions.sessionStore;
  const sessionManager = typedOptions.sessionManager;
  const stateStore = typedOptions.stateStore;
  if (!apiClient || !sessionStore || !stateStore || !sessionManager) {
    throw new Error("createBootstrapHandler requires apiClient, sessionStore, sessionManager, and stateStore.");
  }

  async function fetch(request = { requestId: undefined }, options: any = {}) {
    const didRetry = options.didRetry === true;
    stateStore.setLoading("bootstrap_fetch");
    const session = await sessionManager.ensureSession({ reason: "bootstrap_fetch" });
    if (!session?.access_token) {
      const auth = stateStore.setSignedOut("missing_session");
      await sessionManager.persistAuthState(auth);
      return createOkResult({ auth }, request.requestId);
    }

    const result: any = await apiClient.loadBootstrap();
    if (result.ok === false) {
      const code = result.error?.code || ERROR_CODES.BOOTSTRAP_FAILED;
      if (code === ERROR_CODES.UNAUTHORIZED || code === ERROR_CODES.AUTH_INVALID) {
        if (didRetry) {
          const auth = stateStore.setSignedOut("invalid_session");
          await sessionManager.persistAuthState(auth);
          return createOkResult({ auth }, request.requestId);
        }
        const refreshed = await sessionManager.refreshSession({ reason: "bootstrap_retry", force: true });
        if (refreshed?.access_token) {
          return fetch(request, { didRetry: true });
        }
        const auth = stateStore.setSignedOut("invalid_session");
        await sessionManager.persistAuthState(auth);
        return createOkResult({ auth }, request.requestId);
      }
      const auth = stateStore.setError(result.error, "bootstrap_failed");
      await sessionManager.persistAuthState(auth);
      return createErrorResult(code, result.error.message || "Bootstrap failed.", request.requestId, result.error.details ?? null, { auth });
    }

    const validated: any = validateBootstrapSnapshot(result.data);
    if (validated.ok === false) {
      const auth = stateStore.setError(validated.error, "bootstrap_invalid");
      await sessionManager.persistAuthState(auth);
      return createErrorResult(validated.error.code, validated.error.message, request.requestId, validated.error.details ?? null, { auth });
    }

    const auth = stateStore.setSignedIn({
      session,
      bootstrap: validated.data,
    });
    await sessionManager.persistAuthState(auth);
    return createOkResult({ auth }, request.requestId);
  }

  return {
    fetch,
  };
}
