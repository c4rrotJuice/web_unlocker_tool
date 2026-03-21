import { AUTH_STATUS, createAuthErrorState, createLoadingAuthState, createSignedInAuthState, createSignedOutAuthState, normalizeAuthError } from "../../shared/types/auth.ts";
import { ERROR_CODES } from "../../shared/types/messages.ts";
import { normalizeBootstrapPayload } from "../../shared/types/bootstrap.ts";

export { AUTH_STATUS };

export function createLoadingState(reason = "startup") {
  return createLoadingAuthState(reason);
}

export function createSignedOutState(reason = "signed_out") {
  return createSignedOutAuthState(reason);
}

export function createSignedInState({ session, bootstrap }) {
  return createSignedInAuthState({
    session,
    bootstrap: normalizeBootstrapPayload(bootstrap),
  });
}

export function createErrorState(error, reason = "auth_error") {
  return createAuthErrorState(normalizeAuthError(error, ERROR_CODES.AUTH_INVALID), reason);
}

export function normalizeAuthSnapshot(state) {
  if (!state || typeof state !== "object") {
    return createSignedOutState("missing_state");
  }
  if (state.status === AUTH_STATUS.SIGNED_IN) {
    return createSignedInState({ session: state.session, bootstrap: state.bootstrap });
  }
  if (state.status === AUTH_STATUS.ERROR) {
    return createErrorState(state.error, state.reason);
  }
  if (state.status === AUTH_STATUS.LOADING) {
    return createLoadingState(state.reason);
  }
  return createSignedOutState(state.reason);
}
