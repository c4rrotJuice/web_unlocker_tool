import test from "node:test";
import assert from "node:assert/strict";

import { createFeedbackBus } from "../../app/static/js/shared/feedback/feedback_bus.js";
import { createStatusStore } from "../../app/static/js/shared/feedback/status_store.js";
import { createEventAdapter, createToastStore } from "../../app/static/js/shared/feedback/toast_system.js";
import { FEEDBACK_CONSTANTS, FEEDBACK_EVENTS, STATUS_SCOPES, STATUS_STATES, TOAST_TYPES } from "../../app/static/js/shared/feedback/feedback_tokens.js";

function createRendererHarness() {
  let visible = [];
  const announcements = [];
  return {
    renderer: {
      render(toasts) {
        visible = toasts.slice();
      },
      announce(toast) {
        announcements.push(toast.id);
      },
      bindEscape() {},
    },
    getVisible() {
      return visible.slice();
    },
    getAnnouncements() {
      return announcements.slice();
    },
  };
}

function createToast(type, title, overrides = {}) {
  return {
    id: overrides.id || `${type}_${title}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    description: overrides.description || "",
    actionLabel: overrides.actionLabel || "",
    onAction: overrides.onAction || null,
    duration: overrides.duration ?? 10_000,
    dedupeKey: overrides.dedupeKey || `${type}::${title}::${overrides.description || ""}`,
    priority: overrides.priority || (type === TOAST_TYPES.ERROR ? 4 : type === TOAST_TYPES.WARNING ? 3 : type === TOAST_TYPES.SUCCESS ? 2 : 1),
    createdAt: overrides.createdAt || Date.now(),
    count: 1,
    announced: false,
    mergeCount: 0,
    lastMergedAt: 0,
  };
}

test("toast runtime enforces max three visible toasts and queues non-errors without reshuffling", () => {
  globalThis.window = { setTimeout, clearTimeout };
  const bus = createFeedbackBus();
  const harness = createRendererHarness();
  const store = createToastStore({ bus, renderer: harness.renderer });

  store.add(createToast(TOAST_TYPES.INFO, "one", { id: "one", createdAt: 1 }));
  store.add(createToast(TOAST_TYPES.INFO, "two", { id: "two", createdAt: 2 }));
  store.add(createToast(TOAST_TYPES.INFO, "three", { id: "three", createdAt: 3 }));
  store.add(createToast(TOAST_TYPES.INFO, "four", { id: "four", createdAt: 4 }));

  assert.deepEqual(store.getVisible().map((toast) => toast.id), ["three", "two", "one"]);
  assert.deepEqual(harness.getVisible().map((toast) => toast.id), ["three", "two", "one"]);
});

test("error toast preempts the lowest-priority visible toast when the stack is full", () => {
  globalThis.window = { setTimeout, clearTimeout };
  const bus = createFeedbackBus();
  const harness = createRendererHarness();
  const store = createToastStore({ bus, renderer: harness.renderer });

  store.add(createToast(TOAST_TYPES.INFO, "one", { id: "one", createdAt: 1 }));
  store.add(createToast(TOAST_TYPES.INFO, "two", { id: "two", createdAt: 2 }));
  store.add(createToast(TOAST_TYPES.SUCCESS, "three", { id: "three", createdAt: 3 }));
  store.add(createToast(TOAST_TYPES.ERROR, "four", { id: "four", createdAt: 4 }));

  assert.deepEqual(store.getVisible().map((toast) => toast.id), ["four", "three", "two"]);
});

test("duplicate toasts merge deterministically and announce only once per merge burst", async () => {
  globalThis.window = { setTimeout, clearTimeout };
  const bus = createFeedbackBus();
  const harness = createRendererHarness();
  const store = createToastStore({ bus, renderer: harness.renderer });

  store.add(createToast(TOAST_TYPES.INFO, "Copied", {
    id: "copy_1",
    dedupeKey: "copy",
    createdAt: 1,
  }));
  store.add(createToast(TOAST_TYPES.ERROR, "Copied", {
    id: "copy_2",
    dedupeKey: "copy",
    createdAt: 2,
    priority: 4,
    description: "Different priority should win",
  }));

  const [toast] = store.getVisible();
  assert.equal(toast.id, "copy_1");
  assert.equal(toast.count, 2);
  assert.equal(toast.priority, 4);
  assert.equal(toast.type, TOAST_TYPES.ERROR);
  assert.deepEqual(harness.getAnnouncements(), ["copy_1"]);
});

test("editor saved state respects dwell time and does not flicker during rapid autosave cycles", () => {
  let currentTime = 0;
  const timers = [];
  const statusStore = createStatusStore({
    now: () => currentTime,
    setTimer(callback, delay) {
      timers.push({ callback, runAt: currentTime + delay });
      return timers.length;
    },
    clearTimer() {},
  });

  statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.SAVING);
  statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.SAVED);
  currentTime += FEEDBACK_CONSTANTS.SAVED_DWELL_MS / 2;
  statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.ERROR, { label: "Save failed" });

  assert.equal(statusStore.get(STATUS_SCOPES.EDITOR_DOCUMENT).state, STATUS_STATES.SAVED);

  statusStore.set(STATUS_SCOPES.EDITOR_DOCUMENT, STATUS_STATES.SAVING);
  assert.equal(statusStore.get(STATUS_SCOPES.EDITOR_DOCUMENT).state, STATUS_STATES.SAVING);
});

test("document attach feedback distinguishes direct attach from insert-and-attach flows", () => {
  globalThis.window = { setTimeout, clearTimeout };
  const bus = createFeedbackBus();
  const harness = createRendererHarness();
  const statusStore = createStatusStore({ bus });
  createToastStore({ bus, renderer: harness.renderer });
  const adapter = createEventAdapter({ bus, statusStore });

  adapter.emitDomainEvent(FEEDBACK_EVENTS.CITATION_ATTACHED, { source: "attach" });
  adapter.emitDomainEvent(FEEDBACK_EVENTS.NOTE_ATTACHED, { source: "insert" });

  assert.deepEqual(harness.getVisible().map((toast) => toast.title), [
    "Inserted into document and attached",
    "Attached to document",
  ]);
});
