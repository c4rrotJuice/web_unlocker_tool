import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.ts";
import { toPublicAuthState } from "../../shared/types/auth.ts";
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

  async function reconcileAuthState(request = { requestId: undefined }, options: any = {}) {
    await sessionManager.bootstrapAuthState();
    const session = await sessionManager.ensureSession({
      reason: options.reason || "auth_status",
      forceRefresh: options.forceRefresh === true,
    });
    if (!session?.access_token) {
      const auth = await sessionManager.persistAuthState(stateStore.setSignedOut("missing_session"));
      return { auth, bootstrapResult: null };
    }

    const currentState = stateStore.getState();
    const needsBootstrap = options.forceBootstrap === true
      || currentState.status === "loading"
      || currentState.status === "signed_out"
      || currentState.status === "error"
      || !currentState.bootstrap
      || currentState.session?.access_token !== session.access_token;

    if (!needsBootstrap) {
      return { auth: toPublicAuthState(currentState), bootstrapResult: null };
    }

    const bootstrapResult = await bootstrapHandler.fetch({
      type: "bootstrap.fetch",
      requestId: request.requestId,
      payload: { surface: "background" },
    });
    return {
      auth: toPublicAuthState(stateStore.getState()),
      bootstrapResult,
    };
  }

  async function restoreSession(request = { requestId: undefined }) {
    const { auth, bootstrapResult } = await reconcileAuthState(request, {
      reason: "restore_session",
      forceBootstrap: true,
    });
    if (!bootstrapResult) {
      return createOkResult({ auth }, request.requestId);
    }
    if (bootstrapResult.ok === false) {
      return createErrorResult(
        bootstrapResult.error?.code || ERROR_CODES.BOOTSTRAP_FAILED,
        bootstrapResult.error?.message || "Session restore failed.",
        request.requestId,
        bootstrapResult.error?.details ?? null,
        { auth },
      );
    }
    return createOkResult({ auth }, request.requestId);
  }

  return {
    start(request) {
      return handoffManager.start(request);
    },
    async getStatus(request) {
      const { auth } = await reconcileAuthState(request, {
        reason: "auth_status",
      });
      return createOkResult({ auth }, request.requestId);
    },
    async logout(request) {
      let revokeResult: any = null;
      const session = await sessionStore.read();
      if (session?.access_token) {
        revokeResult = await apiClient.logoutSession();
      }
      const revokeFailed = revokeResult?.ok === false;
      const auth = await sessionManager.clearSession(revokeFailed ? "signed_out_revoke_failed" : "signed_out");
      await citationStateStore?.clear?.();
      return createOkResult(
        { auth },
        request.requestId,
        {
          upstream_logout: !session?.access_token
            ? { attempted: false, status: "no_session" }
            : revokeFailed
              ? { attempted: true, status: "failed", error: revokeResult.error }
              : { attempted: true, status: "revoked" },
        },
      );
    },
    restoreSession,
  };
}
