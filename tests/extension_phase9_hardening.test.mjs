import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { createBackgroundRouter } from "../extension/background/messaging/router.js";
import { createCitationStateStore } from "../extension/background/state/citation_state.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { renderSidepanelAuthSnapshot } from "../extension/sidepanel/app/index.js";

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createStorageArea(seed = {}) {
  const state = { ...seed };
  return {
    state,
    async get(defaults) {
      return { ...defaults, ...state };
    },
    async set(values) {
      Object.assign(state, values);
    },
    async remove(key) {
      delete state[key];
    },
  };
}

function createChromeStub(storageSeed = {}) {
  const storageArea = createStorageArea(storageSeed);
  const listeners = {
    message: null,
    installed: null,
    startup: null,
  };
  const tabsCreateCalls = [];
  return {
    listeners,
    tabsCreateCalls,
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        },
      },
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        },
      },
      onStartup: {
        addListener(listener) {
          listeners.startup = listener;
        },
      },
      sendMessage() {},
    },
    tabs: {
      async create(args) {
        tabsCreateCalls.push(args);
        return args;
      },
    },
    storage: {
      local: storageArea,
    },
  };
}

function createFetchStub({ bootstrapBody } = {}) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url) => {
      const normalizedUrl = String(url);
      requests.push(normalizedUrl);
      if (normalizedUrl.endsWith("/api/extension/bootstrap")) {
        return createResponse(bootstrapBody || {
          ok: true,
          data: {
            profile: { display_name: "Researcher" },
            entitlement: { tier: "standard", status: "active" },
            capabilities: { citation_styles: ["apa", "mla"], extension: { work_in_editor_flow: true } },
            app: {
              origin: "https://app.writior.com",
              handoff: { preferred_destination: "https://app.writior.com/editor/live" },
              routes: { editor_url: "https://app.writior.com/editor/live" },
            },
            taxonomy: { recent_projects: [], recent_tags: [] },
          },
        });
      }
      return createResponse({ ok: true, data: null });
    },
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "").toUpperCase();
    this.children = [];
    this._innerHTML = "";
  }

  replaceChildren(...children) {
    this.children = children;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

test("worker registers listeners once and rehydrates on startup and install", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      source: "background",
    },
  });
  const { fetchImpl, requests } = createFetchStub();
  const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });

  assert.equal(runtime.registerLifecycleHooks(), true);
  assert.equal(runtime.registerLifecycleHooks(), true);
  assert.equal(typeof chromeApi.listeners.message, "function");
  assert.equal(typeof chromeApi.listeners.installed, "function");
  assert.equal(typeof chromeApi.listeners.startup, "function");

  await runtime.bootstrap();
  chromeApi.listeners.installed();
  chromeApi.listeners.startup();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const bootstrapCalls = requests.filter((entry) => entry.endsWith("/api/extension/bootstrap"));
  assert.equal(bootstrapCalls.length, 3);
});

test("citation selection state survives cold start and clears on logout", async () => {
  const chromeApi = createChromeStub();
  const store = createCitationStateStore(undefined, { chromeApi });

  await store.saveSelection({
    citationId: "citation-1",
    style: "chicago",
    format: "footnote",
    copy: false,
  });

  const nextStore = createCitationStateStore(undefined, { chromeApi });
  await nextStore.hydrate();
  assert.equal(nextStore.getState().citationId, "citation-1");
  assert.equal(nextStore.getState().selectedStyle, "chicago");
  assert.equal(nextStore.getState().selectedFormat, "footnote");

  await nextStore.clear();
  const reloadedStore = createCitationStateStore(undefined, { chromeApi });
  await reloadedStore.hydrate();
  assert.equal(reloadedStore.getState().citationId, null);
});

test("router surfaces invalid handler results explicitly instead of returning malformed payloads", async () => {
  const router = createBackgroundRouter({
    handlers: {
      ui: {
        async ping() {
          return { ok: "yes" };
        },
      },
    },
  });

  const result = await router({
    type: MESSAGE_NAMES.PING,
    requestId: "req-1",
    payload: { surface: "popup" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unexpected_error");
  assert.match(result.error.message, /invalid result/);
});

test("sidepanel auth snapshot does not fabricate a manual editor path fallback", () => {
  const root = new FakeElement("section");
  renderSidepanelAuthSnapshot(root, {
    status: "signed_in",
    session: { email: "user@example.com" },
    bootstrap: {
      profile: { display_name: "Researcher" },
      entitlement: { tier: "standard" },
      capabilities: {},
      app: {},
    },
  });

  assert.match(root.innerHTML, /Unavailable until bootstrap resolves/);
  assert.equal(root.innerHTML.includes("/editor"), false);
});

test("build output is regenerated from ts sources and stamped as generated", () => {
  const generatedFiles = [
    "extension/background/index.js",
    "extension/sidepanel/main.js",
    "extension/popup/main.js",
    "extension/content/bundle.js",
  ];
  for (const file of generatedFiles) {
    const source = fs.readFileSync(path.resolve(file), "utf8");
    assert.match(source, /^\/\/ GENERATED FILE\. DO NOT EDIT\./);
  }
});
