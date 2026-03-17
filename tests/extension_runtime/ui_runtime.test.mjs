import test from "node:test";
import assert from "node:assert/strict";

import { installFakeDom } from "./helpers/fake_dom.mjs";
import { createOverlayRoot } from "../../extension/content/overlay_root.js";
import { renderCaptureTab } from "../../extension/sidepanel/tabs/capture.js";
import { createSidepanelStore } from "../../extension/sidepanel/store.js";
import { createRouter } from "../../extension/background/router.js";
import { putRecord, getRecord } from "../../extension/storage/local_db.js";
import { installFakeIndexedDb } from "./helpers/fake_indexeddb.mjs";

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
