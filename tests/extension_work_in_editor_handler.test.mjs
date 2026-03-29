import test from "node:test";
import assert from "node:assert/strict";

import { createEditorHandler } from "../extension/background/handlers/editor_handler.js";
import { createSidepanelHandler } from "../extension/background/handlers/sidepanel_handler.js";
import { createTabOpener } from "../extension/background/navigation/tabs.js";

function createChromeApi() {
  const tabsCreateCalls = [];
  return {
    tabsCreateCalls,
    tabs: {
      async create(args) {
        tabsCreateCalls.push(args);
        return { id: tabsCreateCalls.length, ...args };
      },
    },
  };
}

function createStateStore(bootstrap = {}) {
  return {
    getState() {
      return { bootstrap };
    },
  };
}

test("work-in-editor handler opens the backend-returned editor_url through the shared tab opener", async () => {
  const chromeApi = createChromeApi();
  const stateStore = createStateStore({
    app: { origin: "https://app.writior.com" },
  });
  const tabOpener = createTabOpener({ chromeApi, stateStore });
  const handler = createEditorHandler({
    workInEditorApi: {
      async requestWorkInEditor() {
        return {
          ok: true,
          data: {
            document_id: "doc-1",
            editor_url: "https://app.writior.com/editor/from-backend?seed=doc-1",
          },
        };
      },
    },
    tabOpener,
  });

  const result = await handler.requestWorkInEditor({
    requestId: "work-1",
    payload: { surface: "content", url: "https://example.com/article" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.url, "https://app.writior.com/editor/from-backend?seed=doc-1");
  assert.deepEqual(chromeApi.tabsCreateCalls, [{
    url: "https://app.writior.com/editor/from-backend?seed=doc-1",
    active: true,
  }]);
});

test("work-in-editor handler returns contract errors without opening tabs", async () => {
  const chromeApi = createChromeApi();
  const stateStore = createStateStore({
    app: { origin: "https://app.writior.com" },
  });
  const handler = createEditorHandler({
    workInEditorApi: {
      async requestWorkInEditor() {
        return {
          ok: false,
          error: {
            code: "invalid_payload",
            message: "Work-in-editor response must include editor_url.",
            details: null,
          },
        };
      },
    },
    tabOpener: createTabOpener({ chromeApi, stateStore }),
  });

  const result = await handler.requestWorkInEditor({
    requestId: "work-2",
    payload: { surface: "content", url: "https://example.com/article" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(chromeApi.tabsCreateCalls.length, 0);
});

test("sidepanel open actions resolve canonical bootstrap destinations through the shared tab opener", async () => {
  const chromeApi = createChromeApi();
  const stateStore = createStateStore({
    app: {
      origin: "https://app.writior.com",
      handoff: { preferred_destination: "/editor/from-bootstrap" },
      routes: { dashboard_path: "/dashboard/from-bootstrap" },
    },
  });
  const handler = createSidepanelHandler({
    apiClient: {
      async listCitations() {
        return { ok: true, data: [] };
      },
      async listNotes() {
        return { ok: true, data: [] };
      },
      async updateNote() {
        return { ok: true, data: {} };
      },
    },
    stateStore,
    tabOpener: createTabOpener({ chromeApi, stateStore }),
  });

  const editorResult = await handler.openEditor({ requestId: "open-editor", payload: { surface: "sidepanel" } });
  const dashboardResult = await handler.openDashboard({ requestId: "open-dashboard", payload: { surface: "sidepanel" } });

  assert.equal(editorResult.ok, true);
  assert.equal(dashboardResult.ok, true);
  assert.deepEqual(chromeApi.tabsCreateCalls, [
    { url: "https://app.writior.com/editor/from-bootstrap", active: true },
    { url: "https://app.writior.com/dashboard/from-bootstrap", active: true },
  ]);
});
