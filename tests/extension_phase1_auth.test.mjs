import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createApiClient } from "../extension/background/api/client.js";
import { createSessionStore } from "../extension/background/auth/session_store.js";
import { createBackgroundRuntime } from "../extension/background/runtime/bootstrap.js";
import { createBackgroundStateStore } from "../extension/background/state/index.js";
import { AUTH_STATUS } from "../extension/shared/types/auth.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { STORAGE_KEYS } from "../extension/shared/constants/storage_keys.js";

function createChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  const openedTabs = [];
  return {
    openedTabs,
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
    tabs: {
      async create(payload) {
        openedTabs.push(payload);
        return { id: openedTabs.length, ...payload };
      },
      async query() {
        return [{ windowId: 1 }];
      },
    },
    sidePanel: {
      async open() {},
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

function createFetchStub({ bootstrapBody, attemptBody, statusBody, exchangeBody, forceNetworkError = false } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    if (forceNetworkError) {
      throw new Error("network down");
    }
    const normalizedUrl = String(url);
    requests.push({
      url: normalizedUrl,
      method: init.method || "GET",
      headers: Object.fromEntries(new Headers(init.headers || {}).entries()),
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (normalizedUrl.endsWith("/api/auth/handoff/attempts")) {
      return createResponse(attemptBody || {
        ok: true,
        data: {
          attempt_id: "attempt-1",
          attempt_token: "token-1",
          status: "pending",
          redirect_path: "/dashboard",
          expires_at: "2030-01-01T00:00:00Z",
        },
      });
    }
    if (normalizedUrl.endsWith("/api/auth/handoff/attempts/attempt-1")) {
      return createResponse(statusBody || {
        ok: true,
        data: {
          attempt_id: "attempt-1",
          status: "ready",
          redirect_path: "/dashboard",
          expires_at: "2030-01-01T00:00:00Z",
          exchange: {
            code: "handoff-1",
            exchange_path: "/api/auth/handoff/exchange",
          },
        },
      });
    }
    if (normalizedUrl.endsWith("/api/auth/handoff/exchange")) {
      return createResponse(exchangeBody || {
        ok: true,
        data: {
          redirect_path: "/dashboard",
          session: {
            access_token: "access-1",
            refresh_token: "refresh-1",
            token_type: "bearer",
            user_id: "user-1",
            email: "user@example.com",
          },
        },
      });
    }
    if (normalizedUrl.endsWith("/api/extension/bootstrap")) {
      return createResponse(bootstrapBody || {
        ok: true,
        data: {
          profile: { display_name: "User One", email: "user@example.com" },
          entitlement: { tier: "standard", status: "active" },
          capabilities: { tier: "standard", documents: {} },
          app: {
            origin: "https://app.writior.com",
            handoff: {
              issue_path: "/api/auth/handoff",
              exchange_path: "/api/auth/handoff/exchange",
              preferred_destination: "/editor",
            },
          },
          taxonomy: { recent_projects: [], recent_tags: [] },
        },
      });
    }
    return createResponse({ ok: false, error: { code: "unexpected", message: normalizedUrl } }, 404);
  };
  return { fetchImpl, requests };
}

function read(file) {
  return fs.readFileSync(path.join("extension", file), "utf8");
}

test("session store writes reads and clears token state in background only", async () => {
  const chromeApi = createChromeStub();
  const store = createSessionStore({ chromeApi });

  await store.write({
    access_token: "token-1",
    refresh_token: "refresh-1",
    token_type: "bearer",
  });

  const readBack = await store.read();
  assert.equal(readBack.access_token, "token-1");
  assert.equal(await store.getToken(), "token-1");

  await store.clear();
  assert.equal(await store.read(), null);
});

test("session store migrates legacy auth key into canonical storage", async () => {
  const chromeApi = createChromeStub({
    [STORAGE_KEYS.AUTH_SESSION_LEGACY]: {
      access_token: "legacy-token-1",
      refresh_token: "legacy-refresh-1",
      token_type: "bearer",
      user_id: "user-legacy",
    },
  });
  const store = createSessionStore({ chromeApi });

  const readBack = await store.read();
  const stored = await chromeApi.storage.local.get({
    [STORAGE_KEYS.AUTH_SESSION]: null,
    [STORAGE_KEYS.AUTH_SESSION_LEGACY]: null,
  });

  assert.equal(readBack?.access_token, "legacy-token-1");
  assert.equal(stored[STORAGE_KEYS.AUTH_SESSION]?.access_token, "legacy-token-1");
  assert.equal(stored[STORAGE_KEYS.AUTH_SESSION_LEGACY], null);
});

test("auth state store normalizes loading signed-out signed-in and error states", () => {
  const stateStore = createBackgroundStateStore();
  assert.equal(stateStore.getState().status, AUTH_STATUS.LOADING);
  assert.equal(stateStore.setSignedOut("missing_session").status, AUTH_STATUS.SIGNED_OUT);
  assert.equal(
    stateStore.setSignedIn({
      session: { access_token: "token-1" },
      bootstrap: {
        profile: {},
        entitlement: {},
        capabilities: {},
        app: {},
        taxonomy: {},
      },
    }).status,
    AUTH_STATUS.SIGNED_IN,
  );
  assert.equal(stateStore.setError({ code: "auth_invalid", message: "bad" }).status, AUTH_STATUS.ERROR);
});

test("api client normalizes network and backend auth errors", async () => {
  const networkClient = createApiClient({
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  const networkResult = await networkClient.createAuthAttempt({ redirect_path: "/dashboard" });
  assert.equal(networkResult.ok, false);
  assert.equal(networkResult.error.code, "network_error");

  const backendClient = createApiClient({
    fetchImpl: async () => createResponse({
      ok: false,
      error: { code: "handoff_invalid", message: "Invalid handoff code." },
    }, 400),
  });
  const backendResult = await backendClient.exchangeHandoff({ code: "bad" });
  assert.equal(backendResult.ok, false);
  assert.equal(backendResult.error.code, "handoff_invalid");
});

test("worker restore uses stored token to fetch bootstrap and expose signed-in auth state", async () => {
  const chromeApi = createChromeStub({
    [STORAGE_KEYS.AUTH_SESSION]: {
      access_token: "token-123",
      refresh_token: "refresh-123",
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

  const bootstrapResult = await runtime.bootstrap();
  const stateResult = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_STATUS_GET,
    requestId: "status-1",
    payload: { surface: "popup" },
  });

  assert.equal(bootstrapResult.ok, true);
  assert.equal(stateResult.data.auth.status, "signed_in");
  assert.equal(stateResult.data.auth.bootstrap.profile.display_name, "User One");
  assert.equal(requests[0].headers.authorization, "Bearer token-123");
});

test("worker restore reads legacy stored token and migrates it before bootstrap", async () => {
  const chromeApi = createChromeStub({
    [STORAGE_KEYS.AUTH_SESSION_LEGACY]: {
      access_token: "token-legacy-123",
      refresh_token: "refresh-legacy-123",
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

  const bootstrapResult = await runtime.bootstrap();
  const storage = await chromeApi.storage.local.get({
    [STORAGE_KEYS.AUTH_SESSION]: null,
    [STORAGE_KEYS.AUTH_SESSION_LEGACY]: null,
  });

  assert.equal(bootstrapResult.ok, true);
  assert.equal(requests[0].headers.authorization, "Bearer token-legacy-123");
  assert.equal(storage[STORAGE_KEYS.AUTH_SESSION]?.access_token, "token-legacy-123");
  assert.equal(storage[STORAGE_KEYS.AUTH_SESSION_LEGACY], null);
});

test("auth start runs attempt exchange bootstrap flow and stores token only in background storage", async () => {
  const chromeApi = createChromeStub();
  const { fetchImpl, requests } = createFetchStub();
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
  });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_START,
    requestId: "auth-start-1",
    payload: {
      surface: "popup",
      trigger: "popup_sign_in",
      redirectPath: "/dashboard",
    },
  });

  const stateResult = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_STATUS_GET,
    requestId: "status-2",
    payload: { surface: "popup" },
  });

  assert.equal(result.ok, true);
  assert.equal(stateResult.data.auth.status, "signed_in");
  assert.equal(chromeApi.openedTabs.length, 1);
  assert.match(chromeApi.openedTabs[0].url, /\/auth\?source=extension&attempt=attempt-1&next=%2Fdashboard/);
  assert.equal(requests[2].url.endsWith("/api/auth/handoff/exchange"), true);
  assert.equal(requests[3].url.endsWith("/api/extension/bootstrap"), true);
  assert.equal(read("content/index.ts").includes(STORAGE_KEYS.AUTH_SESSION), false);
});

test("canonical auth exchange errors surface explicitly and leave auth state in error", async () => {
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
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
  });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_START,
    requestId: "auth-start-2",
    payload: {
      surface: "sidepanel",
      trigger: "sidepanel_sign_in",
      redirectPath: "/dashboard",
    },
  });
  const stateResult = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_STATUS_GET,
    requestId: "status-3",
    payload: { surface: "sidepanel" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "handoff_expired");
  assert.equal(stateResult.data.auth.status, "error");
  assert.equal(stateResult.data.auth.error.code, "handoff_expired");
});

test("auth logout clears stored session and returns signed-out state", async () => {
  const chromeApi = createChromeStub({
    [STORAGE_KEYS.AUTH_SESSION]: {
      access_token: "token-123",
      refresh_token: "refresh-123",
      token_type: "bearer",
    },
  });
  const { fetchImpl } = createFetchStub();
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
  });

  await runtime.bootstrap();
  const logoutResult = await runtime.dispatch({
    type: MESSAGE_NAMES.AUTH_LOGOUT,
    requestId: "logout-1",
    payload: { surface: "popup" },
  });

  assert.equal(logoutResult.ok, true);
  assert.equal(logoutResult.data.auth.status, "signed_out");
  assert.equal((await chromeApi.storage.local.get({ [STORAGE_KEYS.AUTH_SESSION]: null }))[STORAGE_KEYS.AUTH_SESSION], null);
});

test("live extension auth flow does not depend on auth handoff landing page DOM", () => {
  const extensionFiles = [
    "background/auth/handoff.ts",
    "background/api/client.ts",
    "background/handlers/auth_handler.ts",
    "popup/main.ts",
    "sidepanel/main.ts",
  ];
  for (const file of extensionFiles) {
    assert.equal(/(^|[^A-Za-z0-9_])\/auth\/handoff([?'"`]|$)/.test(read(file)), false, file);
  }
});
