import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.ts";
import { createHandoffManager } from "../auth/handoff.ts";

export function createAuthHandler(options = {}) {
  const typedOptions: any = options;
  const apiClient = typedOptions.apiClient;
  const sessionStore = typedOptions.sessionStore;
  const sessionManager = typedOptions.sessionManager;
  const stateStore = typedOptions.stateStore;
  const citationStateStore = typedOptions.citationStateStore;
  const bootstrapHandler = typedOptions.bootstrapHandler;
  const chromeApi = typedOptions.chromeApi;
  const baseUrl = typedOptions.baseUrl;
  const pollIntervalMs = typedOptions.pollIntervalMs;
  const maxPollAttempts = typedOptions.maxPollAttempts;
  if (!apiClient || !sessionStore || !sessionManager || !stateStore || !bootstrapHandler) {
    throw new Error("createAuthHandler requires apiClient, sessionStore, sessionManager, stateStore, and bootstrapHandler.");
  }

  const handoffManager = createHandoffManager({
    apiClient,
    sessionStore,
    sessionManager,
    stateStore,
    bootstrapHandler,
    chromeApi,
    baseUrl,
    pollIntervalMs,
    maxPollAttempts,
  });

  return {
    start(request) {
      return handoffManager.start(request);
    },
    async getStatus(request) {
      const currentState = stateStore.getState();
      if (currentState.status === "loading") {
        await this.restoreSession(request);
      }
      return createOkResult({ auth: stateStore.getState() }, request.requestId);
    },
    async logout(request) {
      await sessionManager.clearSession("signed_out");
      await citationStateStore?.clear?.();
      const auth = stateStore.getState();
      return createOkResult({ auth }, request.requestId);
    },
    async restoreSession(request = { requestId: undefined }) {
      await sessionManager.bootstrapAuthState();
      const session = await sessionManager.ensureSession({ reason: "restore_session" });
      if (!session?.access_token) {
        const auth = stateStore.setSignedOut("missing_session");
        await sessionManager.persistAuthState(auth);
        return createOkResult({ auth }, request.requestId);
      }
      const bootstrapResult = await bootstrapHandler.fetch({
        type: "bootstrap.fetch",
        requestId: request.requestId,
        payload: { surface: "background" },
      });
      if (bootstrapResult.ok === false) {
        const auth = stateStore.getState();
        return createErrorResult(
          bootstrapResult.error?.code || ERROR_CODES.BOOTSTRAP_FAILED,
          bootstrapResult.error?.message || "Session restore failed.",
          request.requestId,
          bootstrapResult.error?.details ?? null,
          { auth },
        );
      }
      return bootstrapResult;
    },
  };
}
