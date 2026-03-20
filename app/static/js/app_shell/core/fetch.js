import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES } from "../../shared/feedback/feedback_tokens.js";
import { isAuthSessionError } from "../../shared/auth/session.js";

function redirectToAuth(nextPath) {
  const next = encodeURIComponent(nextPath || window.location.pathname + window.location.search);
  window.location.href = `/auth?next=${next}`;
}

function unwrap(payload) {
  if (payload && typeof payload === "object" && "ok" in payload && "data" in payload) {
    return payload.data;
  }
  return payload;
}

export async function apiFetchJson(path, { signal, redirectOnAuth = true, unwrapEnvelope = true } = {}) {
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
  try {
    const payload = await window.webUnlockerAuth?.authJson?.(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    }, { unwrapEnvelope: false });
    return unwrapEnvelope ? unwrap(payload) : payload;
  } catch (error) {
    if (isAuthSessionError(error)) {
      feedback.emitDomainEvent(FEEDBACK_EVENTS.SESSION_EXPIRED, {
        scope: STATUS_SCOPES.SHELL_SESSION,
        onAction() {
          redirectToAuth(window.location.pathname + window.location.search);
        },
      });
      redirectToAuth(window.location.pathname + window.location.search);
      throw error;
    }
    throw error;
  }
}

export function createLatestRequestTracker() {
  let latest = 0;
  return {
    next() {
      latest += 1;
      return latest;
    },
    isLatest(requestId) {
      return requestId === latest;
    },
  };
}
