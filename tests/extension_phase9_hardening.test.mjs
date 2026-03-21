import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { buildWorkInEditorPayload } from "../extension/shared/types/work_in_editor.js";

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createChromeStub(storage = {}) {
  const storageState = { ...storage };
  const tabsCreateCalls = [];
  return {
    storageState,
    tabsCreateCalls,
    runtime: {
      lastError: null,
      sendMessage() {},
    },
    tabs: {
      async create(args) {
        tabsCreateCalls.push(args);
        return args;
      },
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storageState };
        },
        async set(values) {
          Object.assign(storageState, values);
        },
        async remove(key) {
          delete storageState[key];
        },
      },
    },
  };
}

function createFetchStub({
  bootstrapBody,
  captureBody,
  exchangeBody,
  workInEditorBody,
  captureThrows = false,
} = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const normalizedUrl = String(url);
    requests.push({
      url: normalizedUrl,
      headers: Object.fromEntries(new Headers(init.headers || {}).entries()),
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (normalizedUrl.endsWith("/api/extension/bootstrap")) {
      return createResponse(
        bootstrapBody || {
          ok: true,
          data: {
            profile: { display_name: "Researcher" },
            entitlement: { tier: "standard", status: "active" },
            capabilities: { citation_styles: ["apa", "mla", "chicago", "harvard"], unlocks: true, documents: {} },
            app: { handoff: { preferred_destination: "/editor" } },
            taxonomy: { recent_projects: [], recent_tags: [] },
          },
        },
      );
    }
    if (normalizedUrl.endsWith("/api/extension/captures/citation")) {
      if (captureThrows) {
        throw new Error("capture network failed");
      }
      return createResponse(captureBody || { ok: true, data: { id: "citation-1" } });
    }
    if (normalizedUrl.endsWith("/api/auth/handoff/exchange")) {
      return createResponse(exchangeBody || { ok: true, data: { session: { access_token: "token-1", token_type: "bearer" } } });
    }
    if (normalizedUrl.endsWith("/api/extension/work-in-editor")) {
      return createResponse(
        workInEditorBody || {
          ok: true,
          data: {
            document_id: "doc-1",
            seed: { source: "selection_pill" },
            redirect_path: "/editor",
            editor_path: "/editor/doc-1",
            editor_url: "https://app.writior.com/editor/from-backend?seed=doc-1",
            document: { id: "doc-1" },
            citation: { id: "citation-1" },
            quote: { id: "quote-1" },
            note: { id: "note-1" },
          },
        },
      );
    }
    return createResponse({ ok: true, data: null });
  };
  return { fetchImpl, requests };
}

function read(file) {
  return fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

test("malformed bootstrap responses are rejected as contract errors", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  });
  const { fetchImpl } = createFetchStub({
    bootstrapBody: {
      ok: true,
      data: {
        profile: [],
      },
    },
  });
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  const result = await runtime.bootstrap();
  const state = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(state.data.auth.status, "error");
  assert.equal(state.data.auth.error.code, "invalid_payload");
});

test("malformed work-in-editor responses are rejected before tab creation", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  });
  const { fetchImpl, requests } = createFetchStub({
    workInEditorBody: {
      ok: true,
      data: {
        document_id: "doc-1",
        editor_path: "/editor/doc-1",
      },
    },
  });
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.WORK_IN_EDITOR,
    payload: buildWorkInEditorPayload({
      selectionText: "Editor payload",
      pageTitle: "Demo",
      pageUrl: "https://example.com/articles/demo",
      pageDomain: "example.com",
      source: "selection_pill",
    }),
  }, { tab: { id: 1, windowId: 1 } });

  assert.equal(requests.some((entry) => entry.url.endsWith("/api/extension/work-in-editor")), true);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(chromeApi.tabsCreateCalls.length, 0);
});

test("capture network failure surfaces as a network error", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  });
  const { fetchImpl, requests } = createFetchStub({ captureThrows: true });
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.CAPTURE_CREATE_CITATION,
    payload: {
      selectionText: "Capture text",
      pageTitle: "Demo",
      pageUrl: "https://example.com/articles/demo",
      pageDomain: "example.com",
    },
  }, { tab: { windowId: 1 } });

  assert.equal(requests.some((entry) => entry.url.endsWith("/api/extension/captures/citation")), true);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "network_error");
});

test("sign-out clears the stored session and returns signed-out auth state", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  });
  const { fetchImpl } = createFetchStub();
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  await runtime.bootstrap();
  const signOut = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_SIGN_OUT });
  const state = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE });

  assert.equal(signOut.ok, true);
  assert.equal(state.data.auth.status, "signed_out");
  assert.equal(chromeApi.storageState?.writior_auth_session, undefined);
});

test("repeated handoff errors remain explicit and stable", async () => {
  const chromeApi = createChromeStub();
  const { fetchImpl } = createFetchStub({
    exchangeBody: {
      ok: false,
      error: {
        code: "handoff_expired",
        message: "Handoff expired.",
      },
    },
  });
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  const first = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_EXCHANGE_HANDOFF,
    payload: { code: "handoff-1" },
  });
  const second = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_EXCHANGE_HANDOFF,
    payload: { code: "handoff-1" },
  });
  const state = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE });

  assert.equal(first.ok, false);
  assert.equal(first.error.code, "handoff_expired");
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "handoff_expired");
  assert.equal(state.data.auth.status, "error");
  assert.equal(state.data.auth.error.code, "handoff_expired");
});

test("issue handoff rejects malformed payloads before network access", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  });
  const { fetchImpl, requests } = createFetchStub();
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_ISSUE_HANDOFF,
    payload: { redirect_path: 123 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "handoff_payload_invalid");
  assert.equal(requests.length, 0);
});

test("message shape mismatches are rejected at the router", async () => {
  const chromeApi = createChromeStub();
  const { fetchImpl } = createFetchStub();
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_GET_STATE,
    payload: { unexpected: true },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
});

test("content and popup surfaces remain API-free and non-duplicative", () => {
  const contentBridge = read("extension/content/messaging/bridge.ts");
  const popupMain = read("extension/popup/main.ts");

  assert.equal(contentBridge.includes("fetch("), false);
  assert.equal(contentBridge.includes("XMLHttpRequest"), false);
  assert.equal(popupMain.includes("listCitations"), false);
  assert.equal(popupMain.includes("listNotes"), false);
  assert.equal(popupMain.includes("WORK_IN_EDITOR"), false);
  assert.equal(popupMain.includes("fetch("), false);
});
