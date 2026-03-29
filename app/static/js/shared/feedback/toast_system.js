import { createFeedbackBus } from "./feedback_bus.js";
import { createStatusStore } from "./status_store.js";
import { createToastRenderer } from "./toast_renderer.js";
import {
  FEEDBACK_CONSTANTS,
  FEEDBACK_EVENTS,
  STATUS_SCOPES,
  STATUS_STATES,
  TOAST_PRIORITY,
  TOAST_TYPES,
  getToastDefaults,
} from "./feedback_tokens.js";

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stableDedupeKey(payload) {
  return payload.dedupeKey || [payload.type, payload.title, payload.description || ""].join("::");
}

function toastPriority(type) {
  return TOAST_PRIORITY[type] || TOAST_PRIORITY[TOAST_TYPES.INFO];
}

function attachmentToastTitle(kind, source) {
  const subject = kind === "note" ? "Note" : "Citation";
  return source === "insert"
    ? `${subject} inserted and attached`
    : `${subject} attached`;
}

function detachmentToastTitle(kind) {
  return `${kind === "note" ? "Note" : "Citation"} removed from document`;
}

function toToastPayload(type, title, options = {}) {
  const defaults = getToastDefaults(type);
  return {
    id: options.id || createId(),
    type,
    title,
    description: options.description || "",
    actionLabel: options.actionLabel || "",
    onAction: typeof options.onAction === "function" ? options.onAction : null,
    duration: Number.isFinite(options.duration) ? options.duration : defaults.duration,
    dedupeKey: stableDedupeKey({ type, title, description: options.description, dedupeKey: options.dedupeKey }),
    priority: Number.isFinite(options.priority) ? options.priority : toastPriority(type),
    createdAt: Date.now(),
    count: 1,
    announced: false,
    mergeCount: 0,
    lastMergedAt: 0,
    firstActionLabel: options.actionLabel || "",
  };
}

export function createToastStore({ bus, renderer }) {
  const visible = [];
  const queue = [];
  const activeByKey = new Map();
  const timers = new Map();

  function compare(a, b) {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.createdAt - a.createdAt;
  }

  function clearTimer(id) {
    const timerId = timers.get(id);
    if (!timerId) return;
    window.clearTimeout(timerId);
    timers.delete(id);
  }

  function scheduleDismiss(toast) {
    clearTimer(toast.id);
    if (!toast.duration || toast.duration <= 0) return;
    timers.set(toast.id, window.setTimeout(() => dismiss(toast.id), toast.duration));
  }

  function syncRender(announceToast = null) {
    const orderedVisible = visible.slice().sort(compare);
    renderer.render(orderedVisible, {
      onDismiss: dismiss,
      onAction(id) {
        const toast = visible.find((item) => item.id === id) || queue.find((item) => item.id === id);
        if (!toast?.onAction) return;
        toast.onAction();
        dismiss(id);
      },
    });
    if (announceToast && !announceToast.announced) {
      renderer.announce(announceToast);
      announceToast.announced = true;
    }
  }

  function removeFrom(array, id) {
    const index = array.findIndex((item) => item.id === id);
    if (index === -1) return null;
    return array.splice(index, 1)[0];
  }

  function enqueue(toast) {
    queue.push(toast);
    queue.sort(compare);
  }

  function fillVisible() {
    while (visible.length < FEEDBACK_CONSTANTS.MAX_VISIBLE_TOASTS && queue.length) {
      const next = queue.shift();
      if (Date.now() - next.createdAt >= next.duration && next.duration > 0) continue;
      visible.push(next);
      scheduleDismiss(next);
    }
  }

  function maybePreempt(toast) {
    if (visible.length < FEEDBACK_CONSTANTS.MAX_VISIBLE_TOASTS) {
      visible.push(toast);
      scheduleDismiss(toast);
      return true;
    }
    if (toast.type !== TOAST_TYPES.ERROR) {
      enqueue(toast);
      return false;
    }
    const lowest = visible.slice().sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0];
    if (!lowest || lowest.priority >= toast.priority) {
      enqueue(toast);
      return false;
    }
    removeFrom(visible, lowest.id);
    clearTimer(lowest.id);
    if (!(Date.now() - lowest.createdAt >= lowest.duration && lowest.duration > 0)) {
      enqueue(lowest);
    }
    visible.push(toast);
    scheduleDismiss(toast);
    return true;
  }

  function add(payload) {
    const now = Date.now();
    const existing = activeByKey.get(payload.dedupeKey);
    if (existing && now - existing.lastMergedAt <= FEEDBACK_CONSTANTS.DEDUPE_WINDOW_MS) {
      existing.count += 1;
      existing.mergeCount += 1;
      existing.priority = Math.max(existing.priority, payload.priority);
      existing.type = existing.priority === payload.priority ? payload.type : existing.type;
      existing.lastMergedAt = now;
      if (!existing.burstTimerId) {
        existing.burstTimerId = window.setTimeout(() => {
          existing.burstTimerId = null;
        }, FEEDBACK_CONSTANTS.DEDUPE_WINDOW_MS);
        scheduleDismiss(existing);
      }
      syncRender();
      return existing.id;
    }

    const toast = {
      ...payload,
      lastMergedAt: now,
      announced: false,
      burstTimerId: window.setTimeout(() => {
        toast.burstTimerId = null;
      }, FEEDBACK_CONSTANTS.DEDUPE_WINDOW_MS),
    };
    activeByKey.set(toast.dedupeKey, toast);
    const shownImmediately = maybePreempt(toast);
    if (!shownImmediately && !visible.find((item) => item.id === toast.id)) {
      enqueue(toast);
    }
    fillVisible();
    syncRender(toast);
    return toast.id;
  }

  function dismiss(id) {
    const toast = removeFrom(visible, id) || removeFrom(queue, id);
    if (!toast) return;
    clearTimer(id);
    activeByKey.delete(toast.dedupeKey);
    if (toast.burstTimerId) {
      window.clearTimeout(toast.burstTimerId);
    }
    fillVisible();
    syncRender();
  }

  function clear() {
    for (const toast of [...visible, ...queue]) {
      clearTimer(toast.id);
      if (toast.burstTimerId) {
        window.clearTimeout(toast.burstTimerId);
      }
    }
    visible.splice(0, visible.length);
    queue.splice(0, queue.length);
    activeByKey.clear();
    syncRender();
  }

  function getVisible() {
    return visible.slice().sort(compare);
  }

  function getMostRecentVisibleId() {
    return getVisible()[0]?.id || null;
  }

  renderer.bindEscape(getMostRecentVisibleId, dismiss);

  if (bus) {
    bus.on("feedback:toast:add", (payload) => add(payload));
    bus.on("feedback:toast:dismiss", ({ id }) => dismiss(id));
    bus.on("feedback:toast:clear", () => clear());
  }

  return { add, dismiss, clear, getVisible, getMostRecentVisibleId };
}

export function createEventAdapter({ bus, statusStore }) {
  function emitToast(type, title, options = {}) {
    bus.emit("feedback:toast:add", toToastPayload(type, title, options));
  }

  function handleDomainEvent(eventName, payload = {}) {
    switch (eventName) {
      case FEEDBACK_EVENTS.DOC_SAVE_STARTED:
        statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.SAVING, { label: "Saving…" });
        break;
      case FEEDBACK_EVENTS.DOC_SAVE_SUCCEEDED:
        statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.SAVED, { label: "Saved" });
        break;
      case FEEDBACK_EVENTS.DOC_SAVE_FAILED:
        statusStore.set(
          STATUS_SCOPES.EDITOR_DOCUMENT,
          payload.offline ? STATUS_STATES.OFFLINE : STATUS_STATES.ERROR,
          { label: payload.offline ? "Offline — working locally" : "Save failed" },
        );
        if (!payload.offline) {
          emitToast(TOAST_TYPES.ERROR, "Save failed", {
            description: payload.message || "Your latest edits could not be saved.",
            dedupeKey: "editor-save-failed",
          });
        }
        break;
      case FEEDBACK_EVENTS.DOC_SAVE_CONFLICT:
        statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.CONFLICT, { label: "Conflict" });
        emitToast(TOAST_TYPES.WARNING, "Document conflict", {
          description: payload.message || "Another surface changed this document. Reload latest before saving again.",
          dedupeKey: "editor-save-conflict",
        });
        break;
      case FEEDBACK_EVENTS.CHECKPOINT_CREATED:
        emitToast(TOAST_TYPES.SUCCESS, "Checkpoint created");
        break;
      case FEEDBACK_EVENTS.CHECKPOINT_RESTORED:
        emitToast(TOAST_TYPES.INFO, "Checkpoint restored");
        break;
      case FEEDBACK_EVENTS.DOCUMENT_EXPORT_SUCCEEDED:
        emitToast(TOAST_TYPES.SUCCESS, "Export ready", { description: payload.description || "" });
        break;
      case FEEDBACK_EVENTS.DOCUMENT_EXPORT_FAILED:
        emitToast(TOAST_TYPES.ERROR, "Export failed", { description: payload.message || "" });
        break;
      case FEEDBACK_EVENTS.CITATION_ATTACHED:
        emitToast(TOAST_TYPES.SUCCESS, attachmentToastTitle("citation", payload?.source));
        break;
      case FEEDBACK_EVENTS.CITATION_ATTACH_SKIPPED:
        emitToast(TOAST_TYPES.INFO, "Citation already attached", { dedupeKey: "citation-already-attached" });
        break;
      case FEEDBACK_EVENTS.CITATION_DETACHED:
        emitToast(TOAST_TYPES.INFO, detachmentToastTitle("citation"));
        break;
      case FEEDBACK_EVENTS.NOTE_ATTACHED:
        emitToast(TOAST_TYPES.SUCCESS, attachmentToastTitle("note", payload?.source));
        break;
      case FEEDBACK_EVENTS.NOTE_ATTACH_SKIPPED:
        emitToast(TOAST_TYPES.INFO, "Note already attached", { dedupeKey: "note-already-attached" });
        break;
      case FEEDBACK_EVENTS.NOTE_DETACHED:
        emitToast(TOAST_TYPES.INFO, detachmentToastTitle("note"));
        break;
      case FEEDBACK_EVENTS.QUOTE_INSERTED:
        emitToast(TOAST_TYPES.SUCCESS, payload?.citationId ? "Quote inserted and citation attached" : "Quote inserted");
        break;
      case FEEDBACK_EVENTS.BIBLIOGRAPHY_INSERTED:
        emitToast(TOAST_TYPES.INFO, "Bibliography inserted");
        break;
      case FEEDBACK_EVENTS.CLIPBOARD_COPY_SUCCEEDED:
        emitToast(TOAST_TYPES.SUCCESS, "Copied", {
          description: payload.description || "",
          dedupeKey: payload.dedupeKey || "clipboard-copy-success",
        });
        break;
      case FEEDBACK_EVENTS.CLIPBOARD_COPY_FAILED:
        emitToast(TOAST_TYPES.ERROR, "Copy failed", {
          description: payload.message || "Clipboard access was not available.",
          dedupeKey: payload.dedupeKey || "clipboard-copy-failed",
        });
        break;
      case FEEDBACK_EVENTS.SESSION_EXPIRED:
        statusStore.set(payload.scope || STATUS_SCOPES.SHELL_SESSION, STATUS_STATES.ERROR, { label: "Session expired" });
        emitToast(TOAST_TYPES.ERROR, "Session expired", {
          description: payload.message || "Please sign in again.",
          dedupeKey: `session-expired:${payload.scope || STATUS_SCOPES.SHELL_SESSION}`,
          actionLabel: payload.onAction ? "Sign in" : "",
          onAction: payload.onAction || null,
        });
        break;
      case FEEDBACK_EVENTS.PERMISSION_DENIED:
        emitToast(TOAST_TYPES.ERROR, payload.title || "Action not allowed", {
          description: payload.message || "You do not have access to that action.",
          dedupeKey: payload.dedupeKey || "permission-denied",
        });
        break;
      case FEEDBACK_EVENTS.HANDOFF_STARTED:
        statusStore.set(payload.scope || STATUS_SCOPES.SHELL_HANDOFF, STATUS_STATES.SYNCING, { label: payload.label || "Opening editor…" });
        break;
      case FEEDBACK_EVENTS.HANDOFF_COMPLETED:
        statusStore.set(payload.scope || STATUS_SCOPES.SHELL_HANDOFF, STATUS_STATES.SAVED, { label: payload.label || "Editor opened" });
        emitToast(TOAST_TYPES.SUCCESS, "Editor handoff ready");
        break;
      case FEEDBACK_EVENTS.HANDOFF_FAILED:
        statusStore.set(payload.scope || STATUS_SCOPES.SHELL_HANDOFF, payload.offline ? STATUS_STATES.OFFLINE : STATUS_STATES.ERROR, {
          label: payload.offline ? "Offline — draft saved locally" : "Editor handoff failed",
        });
        emitToast(payload.offline ? TOAST_TYPES.WARNING : TOAST_TYPES.ERROR, payload.offline ? "Saved locally for later" : "Editor handoff failed", {
          description: payload.message || "",
        });
        break;
      case FEEDBACK_EVENTS.EXTENSION_SYNC_STARTED:
        statusStore.set(STATUS_SCOPES.EXTENSION_SYNC, STATUS_STATES.SYNCING, { label: "Syncing…" });
        break;
      case FEEDBACK_EVENTS.EXTENSION_SYNC_COMPLETED:
        statusStore.set(STATUS_SCOPES.EXTENSION_SYNC, STATUS_STATES.SAVED, { label: payload.label || "Synced" });
        if (payload.showToast !== false) {
          emitToast(TOAST_TYPES.SUCCESS, "Sync completed", {
            description: payload.description || "",
            dedupeKey: "extension-sync-completed",
          });
        }
        break;
      case FEEDBACK_EVENTS.EXTENSION_SYNC_FAILED:
        statusStore.set(
          STATUS_SCOPES.EXTENSION_SYNC,
          payload.offline ? STATUS_STATES.OFFLINE : STATUS_STATES.ERROR,
          { label: payload.offline ? "Offline — sync paused" : "Sync failed" },
        );
        emitToast(payload.offline ? TOAST_TYPES.WARNING : TOAST_TYPES.ERROR, payload.offline ? "Offline — sync paused" : "Sync failed", {
          description: payload.message || "",
          dedupeKey: "extension-sync-failed",
        });
        break;
      case FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED:
        statusStore.set(STATUS_SCOPES.RESEARCH_PANEL, STATUS_STATES.ERROR, { label: payload.label || "Research load failed" });
        emitToast(TOAST_TYPES.ERROR, payload.title || "Research action failed", {
          description: payload.message || "",
        });
        break;
      case FEEDBACK_EVENTS.RESEARCH_PANEL_READY:
        statusStore.set(STATUS_SCOPES.RESEARCH_PANEL, STATUS_STATES.SAVED, { label: payload.label || "Research ready" });
        break;
      default:
        break;
    }
  }

  bus.on("feedback:event", ({ eventName, payload }) => handleDomainEvent(eventName, payload));

  return {
    emitDomainEvent(eventName, payload = {}) {
      bus.emit("feedback:event", { eventName, payload });
    },
    emitToast,
  };
}

export function createFeedbackRuntime({ doc = document, mountTarget = document.body } = {}) {
  const bus = createFeedbackBus();
  const renderer = createToastRenderer({ doc, mountTarget });
  const statusStore = createStatusStore({ bus });
  const toastStore = createToastStore({ bus, renderer });
  const adapter = createEventAdapter({ bus, statusStore });

  return {
    bus,
    statusStore,
    toastStore,
    emitDomainEvent: adapter.emitDomainEvent,
    toast: {
      success(title, options) {
        return toastStore.add(toToastPayload(TOAST_TYPES.SUCCESS, title, options));
      },
      error(title, options) {
        return toastStore.add(toToastPayload(TOAST_TYPES.ERROR, title, options));
      },
      warning(title, options) {
        return toastStore.add(toToastPayload(TOAST_TYPES.WARNING, title, options));
      },
      info(title, options) {
        return toastStore.add(toToastPayload(TOAST_TYPES.INFO, title, options));
      },
      dismiss(id) {
        return toastStore.dismiss(id);
      },
      clear() {
        return toastStore.clear();
      },
    },
    status: {
      set(scope, state, meta) {
        return statusStore.set(scope, state, meta);
      },
      get(scope) {
        return statusStore.get(scope);
      },
      subscribe(listener) {
        return statusStore.subscribe(listener);
      },
    },
  };
}
