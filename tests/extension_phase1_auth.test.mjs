import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { renderPopupAuthSnapshot } from "../extension/popup/app/index.js";
import { renderSidepanelAuthSnapshot } from "../extension/sidepanel/app/index.js";

function createChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  return {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage() {},
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
  };
}

function createDomStub() {
  const createNode = (tagName) => ({
    tagName: tagName.toUpperCase(),
    innerHTML: "",
    attributes: {},
    children: [],
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(node) {
      this.children.push(node);
      this.innerHTML += node.innerHTML || "";
    },
  });

  return {
    createElement(tagName) {
      return createNode(tagName);
    },
  };
}

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createFetchStub({ bootstrapBody, exchangeBody } = {}) {
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
            profile: { display_name: "User One" },
            entitlement: { tier: "standard" },
            capabilities: { tier: "standard", documents: {} },
            app: { handoff: { preferred_destination: "/editor" } },
            taxonomy: { recent_projects: [], recent_tags: [] },
          },
        },
      );
    }
    if (normalizedUrl.endsWith("/api/auth/handoff/exchange")) {
      return createResponse(
        exchangeBody || {
          ok: true,
          data: {
            redirect_path: "/editor",
            session: {
              access_token: "access-1",
              refresh_token: "refresh-1",
              token_type: "bearer",
              user_id: "user-1",
              email: "user@example.com",
            },
          },
        },
      );
    }
    return createResponse({ ok: false, error: { code: "unexpected", message: `Unexpected URL ${normalizedUrl}` } }, 404);
  };
  return { fetchImpl, requests };
}

function read(file) {
  return fs.readFileSync(path.join("extension", file), "utf8");
}

test("signed-out startup renders signed-out auth state and keeps token storage background-only", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createDomStub();
  try {
    const chromeApi = createChromeStub();
    const { fetchImpl, requests } = createFetchStub();
    const runtime = createBackgroundRuntime({
      chromeApi,
      fetchImpl,
      baseUrl: "https://app.writior.com",
    });

    const bootstrapResult = await runtime.bootstrap();
    const stateResult = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE });
    const popupRoot = document.createElement("div");
    const sidepanelRoot = document.createElement("div");

    assert.equal(bootstrapResult.ok, true);
    assert.equal(stateResult.data.auth.status, "signed_out");
    assert.equal(renderPopupAuthSnapshot(popupRoot, stateResult.data.auth).mounted, true);
    assert.equal(renderSidepanelAuthSnapshot(sidepanelRoot, stateResult.data.auth).mounted, true);
    assert.match(popupRoot.innerHTML, /Signed out/);
    assert.match(sidepanelRoot.innerHTML, /Signed out/);
    assert.equal(requests.length, 0);
    assert.equal(read("content/index.ts").includes("AUTH_SESSION"), false);
    assert.equal(read("content/index.ts").includes("storage.local"), false);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("valid token restores signed-in state and bootstrap request carries bearer", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = createDomStub();
  try {
    const chromeApi = createChromeStub({
      writior_auth_session: {
        access_token: "token-123",
        token_type: "bearer",
        user_id: "user-1",
        email: "user@example.com",
        source: "background",
      },
    });
    const { fetchImpl, requests } = createFetchStub();
    const runtime = createBackgroundRuntime({
      chromeApi,
      fetchImpl,
      baseUrl: "https://app.writior.com",
    });

    await runtime.bootstrap();
    const stateResult = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE });

    assert.equal(stateResult.data.auth.status, "signed_in");
    assert.equal(stateResult.data.auth.session.access_token, "token-123");
    assert.equal(requests[0].headers.authorization, "Bearer token-123");
    assert.equal(stateResult.data.auth.bootstrap.profile.display_name, "User One");
    assert.equal(stateResult.data.auth.bootstrap.app.handoff.preferred_destination, "/editor");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("handoff exchange error codes map to clear error state", async () => {
  const chromeApi = createChromeStub();
  const { fetchImpl } = createFetchStub({
    exchangeBody: {
      ok: false,
      error: {
        code: "handoff_invalid",
        message: "Invalid handoff code.",
      },
    },
  });
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
  });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_EXCHANGE_HANDOFF,
    payload: { code: "bad-code" },
  });
  const stateResult = await runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "handoff_invalid");
  assert.equal(stateResult.data.auth.status, "error");
  assert.equal(stateResult.data.auth.error.code, "handoff_invalid");
});

test("no extension route depends on auth handoff landing page behavior", () => {
  const extensionFiles = [
    "background/index.ts",
    "background/router.ts",
    "background/api/client.ts",
    "background/api/bootstrap_api.ts",
    "background/auth/handoff.ts",
    "popup/main.ts",
    "sidepanel/main.ts",
  ];
  for (const file of extensionFiles) {
    assert.equal(/(^|[^A-Za-z0-9_])\/auth\/handoff([?'"`]|$)/.test(read(file)), false, file);
  }
});
