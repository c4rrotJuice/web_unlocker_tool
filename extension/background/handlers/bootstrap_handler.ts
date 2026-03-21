import { ERROR_CODES, createErrorResult, createOkResult } from "../../shared/types/messages.ts";
import { validateBootstrapSnapshot } from "../../shared/contracts/validators.ts";

export function createBootstrapHandler({ apiClient, sessionStore, stateStore } = {}) {
  const loadBootstrapFn = apiClient?.loadBootstrap;
  if (typeof loadBootstrapFn !== "function") {
    throw new Error("createBootstrapHandler requires an apiClient with loadBootstrap().");
  }
  if (!sessionStore) {
    throw new Error("createBootstrapHandler requires a sessionStore.");
  }
  if (!stateStore) {
    throw new Error("createBootstrapHandler requires a stateStore.");
  }

  async function loadBootstrap({ reason = "startup" } = {}) {
    stateStore.setLoading(reason);
    const session = await sessionStore.read();
    if (!session?.access_token) {
      const nextState = stateStore.setSignedOut("missing_session");
      return createOkResult({ auth: nextState }, { reason });
    }
    const result = await loadBootstrapFn();
    if (result.ok === false) {
      const code = result.error?.code || ERROR_CODES.BOOTSTRAP_FAILED;
      if (code === ERROR_CODES.UNAUTHORIZED || code === ERROR_CODES.AUTH_INVALID) {
        await sessionStore.clear();
        const nextState = stateStore.setSignedOut("invalid_session");
        return createOkResult({ auth: nextState }, { reason });
      }
      const nextState = stateStore.setError(result.error || { code, message: "Bootstrap failed." }, "bootstrap_failed");
      return createErrorResult(code, result.error?.message || "Bootstrap failed.", result.error?.details ?? null, { reason, auth: nextState });
    }
    const validatedBootstrap = validateBootstrapSnapshot(result.data);
    if (!validatedBootstrap.ok) {
      const nextState = stateStore.setError(validatedBootstrap.error, "bootstrap_invalid");
      return createErrorResult(validatedBootstrap.error.code, validatedBootstrap.error.message, validatedBootstrap.error.details ?? null, { reason, auth: nextState });
    }
    const bootstrap = validatedBootstrap.data;
    const nextState = stateStore.setSignedIn({ session, bootstrap });
    return createOkResult({ auth: nextState }, { reason, bootstrap });
  }

  async function getState() {
    return createOkResult({ auth: stateStore.getState() });
  }

  return {
    loadBootstrap,
    getState,
  };
}
