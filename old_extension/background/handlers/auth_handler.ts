import { ERROR_CODES, createErrorResult, createOkResult } from "../../shared/types/messages.ts";
import { createHandoffManager } from "../auth/handoff.ts";

export function createAuthHandler({ apiClient, sessionStore, stateStore, bootstrapHandler } = {}) {
  if (!apiClient) {
    throw new Error("createAuthHandler requires an apiClient.");
  }
  if (!sessionStore) {
    throw new Error("createAuthHandler requires a sessionStore.");
  }
  if (!stateStore) {
    throw new Error("createAuthHandler requires a stateStore.");
  }

  const handoffManager = createHandoffManager({ apiClient, sessionStore, stateStore, bootstrapHandler });

  async function restoreSession() {
    const bootstrap = await bootstrapHandler.loadBootstrap({ reason: "restore_session" });
    if (bootstrap.ok === false) {
      return bootstrap;
    }
    return bootstrap;
  }

  async function signOut(reason = "signed_out") {
    await sessionStore.clear();
    const nextState = stateStore.setSignedOut(reason);
    return createOkResult({ auth: nextState });
  }

  async function getState() {
    return createOkResult({ auth: stateStore.getState() });
  }

  return {
    getState,
    restoreSession,
    signOut,
    issueHandoff: handoffManager.issueHandoff,
    exchangeHandoff: handoffManager.exchangeHandoff,
    createAuthAttempt: handoffManager.createAuthAttempt,
    getAuthAttemptStatus: handoffManager.getAuthAttemptStatus,
    completeAuthAttempt: handoffManager.completeAuthAttempt,
  };
}
