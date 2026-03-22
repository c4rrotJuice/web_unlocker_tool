import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.ts";
import { createHandoffManager } from "../auth/handoff.ts";

export function createAuthHandler(options = {}) {
  const typedOptions: any = options;
  const apiClient = typedOptions.apiClient;
  const sessionStore = typedOptions.sessionStore;
  const stateStore = typedOptions.stateStore;
  const bootstrapHandler = typedOptions.bootstrapHandler;
  const chromeApi = typedOptions.chromeApi;
  const baseUrl = typedOptions.baseUrl;
  const pollIntervalMs = typedOptions.pollIntervalMs;
  const maxPollAttempts = typedOptions.maxPollAttempts;
  if (!apiClient || !sessionStore || !stateStore || !bootstrapHandler) {
    throw new Error("createAuthHandler requires apiClient, sessionStore, stateStore, and bootstrapHandler.");
  }

  const handoffManager = createHandoffManager({
    apiClient,
    sessionStore,
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
      return createOkResult({ auth: stateStore.getState() }, request.requestId);
    },
    async logout(request) {
      await sessionStore.clear();
      const auth = stateStore.setSignedOut("signed_out");
      return createOkResult({ auth }, request.requestId);
    },
    async restoreSession(request = { requestId: undefined }) {
      const session = await sessionStore.read();
      if (!session?.access_token) {
        const auth = stateStore.setSignedOut("missing_session");
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
