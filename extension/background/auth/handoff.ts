import { ERROR_CODES, createErrorResult } from "../../shared/types/messages.ts";

function mapAuthErrorCode(code) {
  switch (code) {
    case "handoff_invalid":
    case "handoff_expired":
    case "handoff_already_used":
    case "handoff_payload_invalid":
    case "handoff_refresh_failed":
    case "auth_attempt_invalid":
    case "auth_attempt_expired":
      return code;
    default:
      return ERROR_CODES.AUTH_INVALID;
  }
}

function asError(result) {
  if (!result || typeof result !== "object" || result.ok !== false) {
    return null;
  }
  const error = result.error || {};
  return createErrorResult(mapAuthErrorCode(error.code), error.message || "Authentication request failed.", error.details ?? null, result.meta ?? null);
}

export function createHandoffManager({ apiClient, sessionStore, stateStore, bootstrapHandler } = {}) {
  if (!apiClient) {
    throw new Error("createHandoffManager requires an apiClient.");
  }
  if (!sessionStore) {
    throw new Error("createHandoffManager requires a sessionStore.");
  }
  if (!stateStore) {
    throw new Error("createHandoffManager requires a stateStore.");
  }

  async function persistSession(session, bootstrapPayload = null) {
    await sessionStore.write(session);
    if (bootstrapPayload) {
      stateStore.setSignedIn({
        session,
        bootstrap: bootstrapPayload,
      });
      return stateStore.getState();
    }
    return stateStore.getState();
  }

  return {
    async issueHandoff(payload = {}) {
      const accessToken = await sessionStore.getToken();
      if (!accessToken) {
        return createErrorResult(ERROR_CODES.AUTH_INVALID, "No signed-in session is available.", null, null);
      }
      if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
        return createErrorResult(ERROR_CODES.HANDOFF_PAYLOAD_INVALID, "Handoff payload is invalid.", payload, null);
      }
      if ("redirect_path" in payload && payload.redirect_path != null && typeof payload.redirect_path !== "string") {
        return createErrorResult(ERROR_CODES.HANDOFF_PAYLOAD_INVALID, "redirect_path must be a string when provided.", payload, null);
      }
      const result = await apiClient.issueHandoff(payload);
      const error = asError(result);
      if (error) {
        return error;
      }
      return result;
    },
    async exchangeHandoff(payload = {}) {
      const result = await apiClient.exchangeHandoff(payload);
      const error = asError(result);
      if (error) {
        stateStore.setError(error.error || error, "handoff_exchange_failed");
        await sessionStore.clear();
        return error;
      }
      const session = result.data?.session || null;
      if (!session?.access_token) {
        const typed = createErrorResult(ERROR_CODES.AUTH_INVALID, "Handoff exchange did not return a session.", null, result.meta ?? null);
        stateStore.setError(typed.error, "handoff_exchange_failed");
        return typed;
      }
      await persistSession({
        access_token: session.access_token,
        token_type: session.token_type || "bearer",
        user_id: session.user_id || null,
        email: session.email || null,
        issued_at: session.issued_at || new Date().toISOString(),
        expires_at: session.expires_at || null,
        source: "handoff_exchange",
      });
      if (bootstrapHandler?.loadBootstrap) {
        const bootstrapResult = await bootstrapHandler.loadBootstrap({ reason: "handoff_exchange" });
        if (!bootstrapResult?.ok || bootstrapResult.data?.auth?.status !== "signed_in") {
          const refreshError = createErrorResult(ERROR_CODES.HANDOFF_REFRESH_FAILED, "Signed-in session could not be refreshed.", bootstrapResult?.error ?? null, bootstrapResult?.meta ?? null);
          stateStore.setError(refreshError.error, "handoff_refresh_failed");
          return refreshError;
        }
      }
      return result;
    },
    async createAuthAttempt(payload = {}) {
      const result = await apiClient.createAuthAttempt(payload);
      return asError(result) || result;
    },
    async getAuthAttemptStatus(payload = {}) {
      const result = await apiClient.getAuthAttemptStatus(payload);
      return asError(result) || result;
    },
    async completeAuthAttempt({ attempt_id, ...payload } = {}) {
      const result = await apiClient.completeAuthAttempt({ attempt_id, ...payload });
      const error = asError(result);
      if (error) {
        return error;
      }
      return result;
    },
  };
}
