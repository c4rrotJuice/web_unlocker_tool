import { createErrorResult, createOkResult, ERROR_CODES } from "./messages.ts";

export const AUTH_STATUS = Object.freeze({
  LOADING: "loading",
  SIGNED_OUT: "signed_out",
  SIGNED_IN: "signed_in",
  ERROR: "error",
});

export function createLoadingAuthState(reason = "startup") {
  return {
    status: AUTH_STATUS.LOADING,
    reason,
    session: null,
    bootstrap: null,
    error: null,
  };
}

export function createSignedOutAuthState(reason = "missing_session") {
  return {
    status: AUTH_STATUS.SIGNED_OUT,
    reason,
    session: null,
    bootstrap: null,
    error: null,
  };
}

export function createSignedInAuthState({ session, bootstrap }) {
  return {
    status: AUTH_STATUS.SIGNED_IN,
    reason: null,
    session,
    bootstrap,
    error: null,
  };
}

export function createAuthErrorState(error, reason = "auth_error") {
  return {
    status: AUTH_STATUS.ERROR,
    reason,
    session: null,
    bootstrap: null,
    error,
  };
}

export function normalizeAuthError(error, fallbackCode = ERROR_CODES.AUTH_INVALID) {
  if (!error) {
    return {
      code: fallbackCode,
      message: "Authentication failed.",
      details: null,
    };
  }
  if (typeof error === "string") {
    return {
      code: fallbackCode,
      message: error,
      details: null,
    };
  }
  const code = typeof error.code === "string" ? error.code : fallbackCode;
  const message = typeof error.message === "string" && error.message.trim() ? error.message : "Authentication failed.";
  return {
    code,
    message,
    details: error.details ?? error.body ?? null,
  };
}

export function asAuthEnvelope(state, meta = undefined) {
  return createOkResult({ auth: state }, meta);
}

export function asAuthErrorEnvelope(error, meta = undefined) {
  const normalized = normalizeAuthError(error);
  return createErrorResult(normalized.code, normalized.message, normalized.details, meta);
}
