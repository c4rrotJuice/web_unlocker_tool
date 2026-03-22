import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createBackgroundRouter } from "../extension/background/messaging/router.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { createRuntimeClient } from "../extension/shared/utils/runtime_client.js";
import { validateMessageEnvelope } from "../extension/shared/contracts/validators.js";

test("phase 0 envelope validator rejects invalid payload shapes", () => {
  const invalid = validateMessageEnvelope({
    type: MESSAGE_NAMES.PING,
    requestId: "req-1",
    payload: "invalid",
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid_payload");
});

test("phase 0 envelope validator rejects malformed ping payloads without coercion", () => {
  const invalid = validateMessageEnvelope({
    type: MESSAGE_NAMES.PING,
    requestId: "req-2",
    payload: { surface: "popup", href: "" },
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "invalid_payload");
  assert.match(invalid.error.message, /payload\.href/);
});

test("phase 0 envelope validator accepts the canonical ping envelope shape", () => {
  const valid = validateMessageEnvelope({
    type: MESSAGE_NAMES.PING,
    requestId: "req-3",
    payload: { surface: "popup" },
  });

  assert.equal(valid, null);
});

test("phase 0 router returns a standardized error for unknown messages", async () => {
  const routeMessage = createBackgroundRouter({});
  const result = await routeMessage({
    type: "unknown.message",
    requestId: "req-4",
    payload: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.requestId, "req-4");
  assert.equal(result.error.code, "unsupported_message");
});

test("phase 0 router dispatches canonical ping through ui handler", async () => {
  const routeMessage = createBackgroundRouter({
    handlers: {
      ui: {
        ping: async (request) => ({
          ok: true,
          status: "ok",
          requestId: request.requestId,
          data: { ack: true, surface: request.payload.surface },
        }),
        openSidepanel: async () => ({ ok: true, status: "ok", requestId: "open", data: { opened: true } }),
      },
      auth: {
        start: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
        getStatus: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
        logout: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
      },
      bootstrap: {
        fetch: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
      },
      capture: {
        createCitation: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
        createQuote: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
        createNote: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
      },
      editor: {
        requestWorkInEditor: async () => ({ ok: false, status: "error", requestId: "x", error: { code: "not_implemented", message: "x" } }),
      },
    },
  });

  const result = await routeMessage({
    type: MESSAGE_NAMES.PING,
    requestId: "req-5",
    payload: { surface: "popup" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.requestId, "req-5");
  assert.equal(result.data.surface, "popup");
});

test("phase 0 router returns explicit not-implemented result for auth stubs", async () => {
  const routeMessage = createBackgroundRouter({});
  const result = await routeMessage({
    type: MESSAGE_NAMES.AUTH_STATUS_GET,
    requestId: "req-6",
    payload: { surface: "popup" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_implemented");
});

test("phase 0 runtime client uses canonical ping contract and generated request ids", async () => {
  const sentMessages = [];
  const chromeApi = {
    runtime: {
      sendMessage(message, callback) {
        sentMessages.push(message);
        callback({
          ok: true,
          status: "ok",
          requestId: message.requestId,
          data: { ack: true, surface: message.payload.surface },
        });
      },
    },
  };
  const client = createRuntimeClient(chromeApi, "popup");
  const result = await client.ping();

  assert.equal(result.ok, true);
  assert.equal(sentMessages.length, 1);
  assert.equal(typeof sentMessages[0].requestId, "string");
  assert.equal(sentMessages[0].type, MESSAGE_NAMES.PING);
  assert.equal(sentMessages[0].payload.surface, "popup");
});

test("phase 0 live surfaces use the shared runtime client helper", () => {
  const extensionRoot = path.resolve("extension");
  for (const file of ["popup/main.ts", "sidepanel/main.ts", "content/index.ts"]) {
    const source = fs.readFileSync(path.join(extensionRoot, file), "utf8");
    assert.match(source, /createRuntimeClient/);
    assert.equal(source.includes("sendRuntimeMessage("), false);
  }
});
