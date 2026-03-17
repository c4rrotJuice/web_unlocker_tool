export const TOAST_TYPES = Object.freeze({
  SUCCESS: "success",
  ERROR: "error",
  INFO: "info",
  WARNING: "warning",
});

export const TOAST_PRIORITY = Object.freeze({
  [TOAST_TYPES.ERROR]: 4,
  [TOAST_TYPES.WARNING]: 3,
  [TOAST_TYPES.SUCCESS]: 2,
  [TOAST_TYPES.INFO]: 1,
});

export const TOAST_DEFAULTS = Object.freeze({
  [TOAST_TYPES.SUCCESS]: Object.freeze({
    duration: 2000,
    accent: "#22c55e",
    background: "#123222",
    icon: "check-circle",
    live: "polite",
  }),
  [TOAST_TYPES.ERROR]: Object.freeze({
    duration: 5000,
    accent: "#ef4444",
    background: "#34161a",
    icon: "alert-circle",
    live: "assertive",
  }),
  [TOAST_TYPES.INFO]: Object.freeze({
    duration: 2000,
    accent: "#5b8cff",
    background: "#142534",
    icon: "info",
    live: "polite",
  }),
  [TOAST_TYPES.WARNING]: Object.freeze({
    duration: 4000,
    accent: "#f59e0b",
    background: "#3a2a10",
    icon: "alert-triangle",
    live: "polite",
  }),
});

export const STATUS_STATES = Object.freeze({
  SAVING: "saving",
  SAVED: "saved",
  OFFLINE: "offline",
  SYNCING: "syncing",
  ERROR: "error",
});

export const STATUS_SCOPES = Object.freeze({
  EDITOR_DOCUMENT: "editor.document",
  EDITOR_SYNC: "editor.sync",
  RESEARCH_PANEL: "research.panel",
  SHELL_SESSION: "shell.session",
  SHELL_HANDOFF: "shell.handoff",
  EXTENSION_SESSION: "extension.session",
  EXTENSION_SYNC: "extension.sync",
});

export const STATUS_LABELS = Object.freeze({
  [STATUS_STATES.SAVING]: "Saving…",
  [STATUS_STATES.SAVED]: "Saved",
  [STATUS_STATES.OFFLINE]: "Offline",
  [STATUS_STATES.SYNCING]: "Syncing…",
  [STATUS_STATES.ERROR]: "Error",
});

export const FEEDBACK_EVENTS = Object.freeze({
  DOC_SAVE_STARTED: "doc.save.started",
  DOC_SAVE_SUCCEEDED: "doc.save.succeeded",
  DOC_SAVE_FAILED: "doc.save.failed",
  CHECKPOINT_CREATED: "checkpoint.created",
  CHECKPOINT_RESTORED: "checkpoint.restored",
  DOCUMENT_EXPORT_SUCCEEDED: "document.export.succeeded",
  DOCUMENT_EXPORT_FAILED: "document.export.failed",
  CITATION_ATTACHED: "citation.attached",
  CITATION_ATTACH_SKIPPED: "citation.attach_skipped",
  NOTE_ATTACHED: "note.attached",
  QUOTE_INSERTED: "quote.inserted",
  BIBLIOGRAPHY_INSERTED: "bibliography.inserted",
  CLIPBOARD_COPY_SUCCEEDED: "clipboard.copy.succeeded",
  CLIPBOARD_COPY_FAILED: "clipboard.copy.failed",
  SESSION_EXPIRED: "session.expired",
  PERMISSION_DENIED: "permission.denied",
  HANDOFF_STARTED: "handoff.started",
  HANDOFF_COMPLETED: "handoff.completed",
  HANDOFF_FAILED: "handoff.failed",
  EXTENSION_SYNC_STARTED: "extension.sync.started",
  EXTENSION_SYNC_COMPLETED: "extension.sync.completed",
  EXTENSION_SYNC_FAILED: "extension.sync.failed",
  RESEARCH_PANEL_FAILED: "research.panel.failed",
  RESEARCH_PANEL_READY: "research.panel.ready",
});

export const FEEDBACK_CONSTANTS = Object.freeze({
  DEDUPE_WINDOW_MS: 1000,
  MAX_VISIBLE_TOASTS: 3,
  ENTER_MS: 120,
  EXIT_MS: 100,
  SAVED_DWELL_MS: 1200,
});

export function isRegisteredStatusScope(scope) {
  return Object.values(STATUS_SCOPES).includes(scope);
}

export function getToastDefaults(type) {
  return TOAST_DEFAULTS[type] || TOAST_DEFAULTS[TOAST_TYPES.INFO];
}

export function getStatusLabel(state, meta = {}) {
  if (meta.label) return meta.label;
  return STATUS_LABELS[state] || STATUS_LABELS[STATUS_STATES.SAVED];
}
