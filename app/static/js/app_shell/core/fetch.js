import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES } from "../../shared/feedback/feedback_tokens.js";

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

export async function apiFetchJson(path, { signal, redirectOnAuth = true } = {}) {
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
  const res = await window.webUnlockerAuth?.authFetch?.(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });

  if (res.status === 401 && redirectOnAuth) {
    feedback.emitDomainEvent(FEEDBACK_EVENTS.SESSION_EXPIRED, {
      scope: STATUS_SCOPES.SHELL_SESSION,
      onAction() {
        redirectToAuth(window.location.pathname + window.location.search);
      },
    });
    redirectToAuth(window.location.pathname + window.location.search);
    throw new Error("Authentication required");
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const mapped = window.webUnlockerUI?.mapApiError?.(payload);
    const error = new Error(mapped?.message || payload?.detail || "Request failed");
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return unwrap(payload);
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
