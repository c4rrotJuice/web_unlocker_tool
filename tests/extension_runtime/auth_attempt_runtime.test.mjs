import test from "node:test";
import assert from "node:assert/strict";

import { createHandoffManager } from "../../extension/background/handoff_manager.js";

function installChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  const openedTabs = [];
  globalThis.chrome = {
    tabs: {
      async create(payload) {
        openedTabs.push(payload);
        return { id: openedTabs.length };
      },
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(payload) {
          Object.assign(storage, payload);
        },
        async remove(keys) {
          for (const key of keys) {
            delete storage[key];
          }
        },
      },
    },
  };
  return { storage, openedTabs };
}

test("auth sign-in creates attempt and completes secure exchange without bridge", async () => {
  const { storage, openedTabs } = installChromeStub();
  let exchangeCount = 0;
  const manager = createHandoffManager({
    apiClient: {
      async createAuthAttempt() {
        return {
          data: {
            attempt_id: "attempt_1",
            attempt_token: "token_1",
            status: "pending",
            expires_at: "2099-01-01T00:00:00Z",
          },
        };
      },
      async getAuthAttemptStatus() {
        return {
          data: {
            status: "ready",
            redirect_path: "/dashboard",
            exchange: { code: "handoff_1" },
          },
        };
      },
      async exchangeHandoff() {
        exchangeCount += 1;
        return {
          data: {
            redirect_path: "/dashboard",
            session: { access_token: "access", refresh_token: "refresh", expires_in: 300 },
          },
        };
      },
      async issueHandoff() {
        return { data: { code: "handoff" } };
      },
      async workInEditor() {
        return { ok: true };
      },
    },
    sessionManager: {
      async restoreSession() {
        return { is_authenticated: true, email: "user@example.com" };
      },
      async broadcastAuthHydration() {},
      async ensureSession() {
        return { refresh_token: "refresh", expires_in: 300, token_type: "bearer" };
      },
    },
  });

  const result = await manager.openAppSignIn();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(result.ok, true);
  assert.equal(result.data.attempt_id, "attempt_1");
  assert.equal(openedTabs.length, 1);
  assert.match(openedTabs[0].url, /\/auth\?source=extension&attempt=attempt_1/);
  assert.equal(exchangeCount, 1);
  assert.equal(storage.auth_pending_attempt, undefined);
});

test("pending auth attempt recovers after worker wake-up", async () => {
  const { storage } = installChromeStub({
    auth_pending_attempt: {
      attempt_id: "attempt_resume",
      attempt_token: "token_resume",
      expires_at: "2099-01-01T00:00:00Z",
    },
  });
  const manager = createHandoffManager({
    apiClient: {
      async getAuthAttemptStatus() {
        return {
          data: {
            status: "ready",
            redirect_path: "/dashboard",
            exchange: { code: "handoff_resume" },
          },
        };
      },
      async exchangeHandoff() {
        return {
          data: {
            redirect_path: "/dashboard",
            session: { access_token: "access", refresh_token: "refresh", expires_in: 300 },
          },
        };
      },
      async createAuthAttempt() {
        return { data: {} };
      },
      async issueHandoff() {
        return { data: { code: "handoff" } };
      },
      async workInEditor() {
        return { ok: true };
      },
    },
    sessionManager: {
      async restoreSession() {
        return { is_authenticated: true };
      },
      async broadcastAuthHydration() {},
      async ensureSession() {
        return { refresh_token: "refresh", expires_in: 300, token_type: "bearer" };
      },
    },
  });

  const result = await manager.resumePendingAuthAttempt();
  assert.equal(result.ok, true);
  assert.equal(storage.auth_pending_attempt, undefined);
});

test("expired auth attempt clears pending state and returns explicit failure", async () => {
  const { storage } = installChromeStub({
    auth_pending_attempt: {
      attempt_id: "attempt_expired",
      attempt_token: "token_expired",
      expires_at: "2099-01-01T00:00:00Z",
    },
  });
  const manager = createHandoffManager({
    apiClient: {
      async getAuthAttemptStatus() {
        const error = new Error("auth_attempt_expired");
        error.payload = { error: { code: "auth_attempt_expired" } };
        throw error;
      },
      async createAuthAttempt() {
        return { data: {} };
      },
      async exchangeHandoff() {
        return { data: {} };
      },
      async issueHandoff() {
        return { data: { code: "handoff" } };
      },
      async workInEditor() {
        return { ok: true };
      },
    },
    sessionManager: {
      async restoreSession() {
        return { is_authenticated: true };
      },
      async broadcastAuthHydration() {},
      async ensureSession() {
        return { refresh_token: "refresh", expires_in: 300, token_type: "bearer" };
      },
    },
  });

  const result = await manager.resumePendingAuthAttempt();
  assert.equal(result.ok, false);
  assert.equal(result.error, "auth_attempt_expired");
  assert.equal(storage.auth_pending_attempt, undefined);
});
