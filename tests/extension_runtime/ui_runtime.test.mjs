import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { installFakeDom } from "./helpers/fake_dom.mjs";
import { createOverlayRoot } from "../../extension/content/overlay_root.js";
import { renderCaptureTab } from "../../extension/sidepanel/tabs/capture.js";
import { createSidepanelStore } from "../../extension/sidepanel/store.js";
import { createRouter } from "../../extension/background/router.js";
import { putRecord, getRecord, listRecords } from "../../extension/storage/local_db.js";
import { installFakeIndexedDb } from "./helpers/fake_indexeddb.mjs";
import { createPopupActions } from "../../extension/popup/actions.js";
import { isRestrictedRuntimePage, copyTextWithFallback } from "../../extension/content/clipboard.js";

const fakeDb = installFakeIndexedDb();

test.beforeEach(() => {
  fakeDb.reset();
});

test("overlay root mounts on an owned fallback host when the page already owns writior-root", () => {
  const document = installFakeDom();
  const foreignHost = document.createElement("div");
  foreignHost.id = "writior-root";
  document.body.appendChild(foreignHost);

  const overlay = createOverlayRoot();

  assert.notEqual(overlay.host, foreignHost);
  assert.match(overlay.host.id, /^writior-root-/);
  assert.equal(overlay.host.getAttribute("data-writior-overlay-root"), "true");

  const secondOverlay = createOverlayRoot();
  assert.equal(secondOverlay.host, overlay.host);

  secondOverlay.destroy();
  assert.equal(document.getElementById(overlay.host.id), null);
  assert.equal(document.getElementById("writior-root"), foreignHost);
});

test("capture tab exposes compact resume and clear actions for local editor drafts", () => {
  const root = { innerHTML: "" };
  renderCaptureTab(root, {
    status: { sync: { pending: 1, failed: 0, auth_needed: true } },
    summary: {
      drafts: [{
        id: "draft_1",
        type: "work_in_editor_draft",
        title: "Draft title",
        url: "https://example.com/article",
        summary: "Saved selection",
        updated_at: "2026-03-17T00:00:00.000Z",
      }],
      quotes: [{
        id: "quote_1",
        text: "Queued quote text",
        citation_local_id: "citation_1",
        sync_status: "failed_retryable",
        last_error: "citation_dependency_pending",
      }],
      queue_items: [{
        id: "queue_1",
        type: "capture_quote",
        status: "retry",
        last_error: "citation_dependency_pending",
        next_attempt_at: "2026-03-17T00:01:00.000Z",
      }],
    },
  });

  assert.match(root.innerHTML, /Resume in editor/);
  assert.match(root.innerHTML, /Clear local draft/);
  assert.match(root.innerHTML, /Quote queue/);
  assert.match(root.innerHTML, /Queue debug/);
});

test("sidepanel draft actions stay background-routed", async () => {
  const messages = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({ ok: true });
      },
      lastError: null,
    },
    tabs: {
      async query() {
        return [];
      },
    },
  };

  const store = createSidepanelStore();
  await store.resumeEditorDraft("draft_resume");
  await store.removeLocalDraft("draft_clear");

  assert.deepEqual(messages.map((message) => message.type), ["RESUME_EDITOR_DRAFT", "REMOVE_LOCAL_DRAFT"]);
});

test("sidepanel note actions stay background-routed", async () => {
  const messages = [];
  globalThis.chrome = {
    runtime: {
      sendMessage(message, callback) {
        messages.push(message);
        callback({ ok: true });
      },
      lastError: null,
    },
    tabs: {
      async query() {
        return [];
      },
    },
  };

  const store = createSidepanelStore();
  await store.updateNote("note_1", { title: "Updated" });
  await store.deleteNote("note_1");
  assert.deepEqual(messages.map((message) => message.type), ["UPDATE_NOTE", "DELETE_NOTE"]);
});

test("copy assist helpers classify restricted pages and fallback to execCommand when clipboard is unavailable", async () => {
  assert.equal(isRestrictedRuntimePage("chrome://settings"), true);
  assert.equal(isRestrictedRuntimePage("https://example.com"), false);

  const appended = [];
  const fakeTextarea = {
    style: {},
    setAttribute() {},
    focus() {},
    select() {},
    remove() {},
  };
  const documentRef = {
    body: {
      appendChild(node) {
        appended.push(node);
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      return fakeTextarea;
    },
    execCommand(command) {
      assert.equal(command, "copy");
      return true;
    },
  };
  const navigatorRef = {
    clipboard: {
      async writeText() {
        throw new Error("clipboard_blocked");
      },
    },
  };
  const result = await copyTextWithFallback("hello", { navigatorRef, documentRef });
  assert.equal(result.ok, true);
  assert.equal(result.method, "execCommand");
  assert.equal(appended.length, 1);
});

test("popup work-in-editor seeds selection text from background authority state", async () => {
  const sent = [];
  globalThis.chrome = {
    tabs: {
      async query() {
        return [{ url: "https://example.com/page", title: "Example Page" }];
      },
    },
    runtime: {
      sendMessage(message, callback) {
        sent.push(message);
        if (message.type === "GET_LAST_SELECTION") {
          callback({ ok: true, data: { text: "Seed from selection" } });
          return;
        }
        callback({ ok: true });
      },
      lastError: null,
    },
  };

  const actions = createPopupActions();
  await actions.workInEditor();

  const workMessage = sent.find((entry) => entry.type === "WORK_IN_EDITOR");
  assert.ok(workMessage);
  assert.equal(workMessage.payload.selected_text, "Seed from selection");
});

test("resume editor draft reuses persisted local payload and clears only after successful handoff", async () => {
  await putRecord("captures", {
    id: "draft_resume_1",
    type: "work_in_editor_draft",
    payload: {
      url: "https://example.com/draft",
      title: "Draft article",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  let resumedPayload = null;
  const router = createRouter({
    apiClient: {},
    sessionManager: {
      async getPublicSessionState() {
        return {};
      },
      async logout() {},
    },
    capabilityCache: {
      async summarize() {
        return {};
      },
    },
    queueManager: {
      async enqueue() {},
    },
    syncManager: {
      async flush() {
        return { ok: true };
      },
    },
    handoffManager: {
      async workInEditor(payload) {
        resumedPayload = payload;
        return { ok: true };
      },
      async restoreAuthSession() {
        return { ok: true };
      },
      async openAppSignIn() {
        return { ok: true };
      },
    },
    sidepanelManager: {
      async getState() {
        return {};
      },
      async openSidePanel() {
        return { ok: true };
      },
    },
    workspaceSummary: {
      async getSummary() {
        return {};
      },
    },
  });

  const result = await router({ type: "RESUME_EDITOR_DRAFT", payload: { id: "draft_resume_1" } }, {});

  assert.equal(result.ok, true);
  assert.deepEqual(resumedPayload, {
    url: "https://example.com/draft",
    title: "Draft article",
  });
  assert.equal(await getRecord("captures", "draft_resume_1"), null);
});

test("background router persists capture UI toggle state and selection text authority", async () => {
  const storage = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
      },
    },
    tabs: {
      async create() {},
    },
  };

  const router = createRouter({
    apiClient: {},
    sessionManager: {
      async getPublicSessionState() {
        return {};
      },
      async logout() {},
    },
    capabilityCache: {
      async summarize() {
        return {};
      },
    },
    queueManager: {
      async enqueue() {},
    },
    syncManager: {
      async flush() {
        return { ok: true };
      },
    },
    handoffManager: {
      async workInEditor() {
        return { ok: true };
      },
      async restoreAuthSession() {
        return { ok: true };
      },
      async openAppSignIn() {
        return { ok: true };
      },
    },
    sidepanelManager: {
      async getState() {
        return {};
      },
      async openSidePanel() {
        return { ok: true };
      },
    },
    workspaceSummary: {
      async getSummary() {
        return { queue: { pending: 0, failed: 0, auth_needed: false } };
      },
    },
  });

  await router({ type: "SET_CAPTURE_UI_ENABLED", payload: { enabled: false } }, {});
  await router({ type: "SET_LAST_SELECTION", payload: { text: "captured text" } }, {});
  const status = await router({ type: "GET_STATUS" }, {});

  assert.equal(status.ok, true);
  assert.equal(status.data.capture_ui.enabled, false);
  assert.equal(status.data.capture_ui.last_selection, "captured text");
});

test("background router note update/delete queue local-first intents", async () => {
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults };
        },
        async set() {},
      },
    },
    tabs: {
      async create() {},
    },
  };
  const queueCalls = [];
  await putRecord("notes", {
    id: "note_local_1",
    title: "Original",
    note_body: "Body",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const router = createRouter({
    apiClient: {},
    sessionManager: {
      async getPublicSessionState() {
        return {};
      },
      async logout() {},
    },
    capabilityCache: {
      async summarize() {
        return {};
      },
    },
    queueManager: {
      async enqueue(type, payload, options) {
        queueCalls.push({ type, payload, options });
      },
    },
    syncManager: {
      async flush() {
        return { ok: true };
      },
    },
    handoffManager: {
      async workInEditor() {
        return { ok: true };
      },
      async restoreAuthSession() {
        return { ok: true };
      },
      async openAppSignIn() {
        return { ok: true };
      },
    },
    sidepanelManager: {
      async getState() {
        return {};
      },
      async openSidePanel() {
        return { ok: true };
      },
    },
    workspaceSummary: {
      async getSummary() {
        return {};
      },
    },
  });

  const updateResult = await router({
    type: "UPDATE_NOTE",
    payload: { id: "note_local_1", patch: { title: "Edited title", note_body: "Edited body" } },
  }, {});
  const deleteResult = await router({
    type: "DELETE_NOTE",
    payload: { id: "note_local_1" },
  }, {});

  assert.equal(updateResult.ok, true);
  assert.equal(deleteResult.ok, true);
  assert.equal(queueCalls.some((entry) => entry.type === "update_note"), true);
  assert.equal(queueCalls.some((entry) => entry.type === "delete_note"), true);

  const notes = await listRecords("notes");
  assert.equal(notes.some((note) => note.id === "note_local_1"), true);
});

test("content runtime keeps cite preview flow wired from pill action", () => {
  const capturePillSource = fs.readFileSync("extension/content/capture_pill.js", "utf8");
  const previewSource = fs.readFileSync("extension/content/citation_preview.js", "utf8");
  assert.match(capturePillSource, /data-action=\"cite\"/);
  assert.match(capturePillSource, /openCitationPreview/);
  assert.match(previewSource, /Citation preview/);
  assert.match(previewSource, /Save citation/);
});

test("selection watcher guards against collapsed or editable selections", () => {
  const watcherSource = fs.readFileSync("extension/content/selection_watcher.js", "utf8");
  assert.match(watcherSource, /range\.collapsed/);
  assert.match(watcherSource, /isEditable/);
  assert.match(watcherSource, /payload\.rect\?\.top/);
});
