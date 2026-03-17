import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundRuntime, REPLAY_EXACT_ALARM, REPLAY_PERIODIC_ALARM } from "../../extension/background/index.js";

function createChromeStub() {
  const listeners = {
    alarm: null,
    installed: null,
    startup: null,
    message: null,
  };
  const createdAlarms = [];
  const clearedAlarms = [];

  return {
    listeners,
    createdAlarms,
    clearedAlarms,
    alarms: {
      create(name, info) {
        createdAlarms.push({ name, info });
      },
      clear(name) {
        clearedAlarms.push(name);
      },
      onAlarm: {
        addListener(listener) {
          listeners.alarm = listener;
        },
      },
    },
    runtime: {
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
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        },
      },
    },
  };
}

test("background runtime schedules exact replay alarm from earliest queued retry and wakes on lifecycle triggers", async () => {
  const chromeApi = createChromeStub();
  const globalScope = {
    onlineListener: null,
    addEventListener(eventName, listener) {
      if (eventName === "online") {
        this.onlineListener = listener;
      }
    },
  };
  let flushCount = 0;
  const runtime = createBackgroundRuntime({
    chromeApi,
    globalScope,
    sessionManager: {
      async ensureSession() {
        return { access_token: "token" };
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
    createApiClientFn: () => ({
      async bootstrap() {
        return { data: { capabilities: { can_capture: true } } };
      },
    }),
    capabilityCache: {
      async write() {},
    },
    createQueueManagerFn: () => ({
      async getNextReplayAt() {
        return new Date(Date.now() + 60_000).toISOString();
      },
    }),
    createSyncManagerFn: () => ({
      async flush() {
        flushCount += 1;
      },
    }),
    createHandoffManagerFn: () => ({}),
    createRouterFn: () => async () => ({ ok: true }),
  });

  runtime.registerLifecycleHooks();

  assert.equal(chromeApi.createdAlarms[0].name, REPLAY_PERIODIC_ALARM);

  await runtime.scheduleReplayAlarm();
  const exactAlarm = chromeApi.createdAlarms.find((alarm) => alarm.name === REPLAY_EXACT_ALARM);
  assert.ok(exactAlarm);
  assert.ok(exactAlarm.info.when > Date.now());

  await chromeApi.listeners.installed();
  await chromeApi.listeners.startup();
  chromeApi.listeners.alarm({ name: REPLAY_EXACT_ALARM });
  globalScope.onlineListener();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(flushCount, 4);
});
