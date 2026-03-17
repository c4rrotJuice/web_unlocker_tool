import {
  FEEDBACK_CONSTANTS,
  STATUS_SCOPES,
  STATUS_STATES,
  getStatusLabel,
  isRegisteredStatusScope,
} from "./feedback_tokens.js";

export function createStatusStore({ bus, now = () => Date.now(), setTimer = window.setTimeout, clearTimer = window.clearTimeout } = {}) {
  const scopeState = new Map();
  const listeners = new Set();

  function emit(nextScope, previous) {
    const snapshot = nextScope ? get(nextScope) : getAll();
    for (const listener of listeners) {
      listener(snapshot, { scope: nextScope, previous });
    }
    if (bus && nextScope) {
      bus.emit("feedback:status:changed", { scope: nextScope, status: snapshot, previous });
    }
  }

  function announce(next, previous) {
    if (!bus || !next) return;
    const previousState = previous?.state || null;
    const nextState = next.state;
    const shouldAnnounce =
      nextState === STATUS_STATES.OFFLINE
      || nextState === STATUS_STATES.ERROR
      || (previousState === STATUS_STATES.ERROR && nextState === STATUS_STATES.SAVED)
      || (previousState === STATUS_STATES.OFFLINE && nextState === STATUS_STATES.SAVED);
    if (!shouldAnnounce) return;
    bus.emit("feedback:status:announce", {
      scope: next.scope,
      label: next.label,
      state: next.state,
      polite: true,
    });
  }

  function apply(scope, state, meta = {}) {
    const previous = scopeState.get(scope) || null;
    const next = {
      scope,
      state,
      label: getStatusLabel(state, meta),
      meta: { ...meta },
      updatedAt: now(),
      announcedAt: null,
      timerId: null,
      pending: null,
    };
    if (previous?.timerId) {
      clearTimer(previous.timerId);
    }
    scopeState.set(scope, next);
    emit(scope, previous);
    announce(next, previous);
    return next;
  }

  function set(scope, state, meta = {}) {
    if (!isRegisteredStatusScope(scope)) {
      throw new Error(`Unregistered status scope: ${scope}`);
    }
    const previous = scopeState.get(scope) || null;
    if (
      scope === STATUS_SCOPES.EDITOR_DOCUMENT
      && previous?.state === STATUS_STATES.SAVED
      && state !== STATUS_STATES.SAVING
      && now() - previous.updatedAt < FEEDBACK_CONSTANTS.SAVED_DWELL_MS
    ) {
      const remaining = FEEDBACK_CONSTANTS.SAVED_DWELL_MS - (now() - previous.updatedAt);
      if (previous.timerId) {
        clearTimer(previous.timerId);
      }
      previous.pending = { state, meta };
      previous.timerId = setTimer(() => {
        const current = scopeState.get(scope);
        if (!current?.pending) return;
        apply(scope, current.pending.state, current.pending.meta);
      }, remaining);
      scopeState.set(scope, previous);
      return get(scope);
    }
    return apply(scope, state, meta);
  }

  function clear(scope) {
    const existing = scopeState.get(scope);
    if (!existing) return;
    if (existing.timerId) {
      clearTimer(existing.timerId);
    }
    scopeState.delete(scope);
    emit(scope, existing);
  }

  function get(scope) {
    const current = scopeState.get(scope);
    if (!current) return null;
    return {
      scope: current.scope,
      state: current.state,
      label: current.label,
      meta: { ...current.meta },
      updatedAt: current.updatedAt,
    };
  }

  function getAll() {
    return Array.from(scopeState.keys()).sort().map((scope) => get(scope)).filter(Boolean);
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getAll(), { scope: null, previous: null });
    return () => listeners.delete(listener);
  }

  return { set, get, getAll, clear, subscribe };
}
