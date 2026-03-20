import { createApiClient } from "./api_client.js";
import { createSessionManager } from "./session_manager.js";
import { createCapabilityCache } from "./capability_cache.js";
import { createQueueManager } from "./queue_manager.js";
import { createSyncManager } from "./sync_manager.js";
import { createHandoffManager } from "./handoff_manager.js";
import { createSidepanelManager } from "./sidepanel_manager.js";
import { createWorkspaceSummary } from "./workspace_summary.js";
import { createRouter } from "./router.js";
import { createLogger } from "../shared/log.js";

const logger = createLogger("background");
export const REPLAY_PERIODIC_ALARM = "writior-sync-replay";
export const REPLAY_EXACT_ALARM = "writior-sync-replay-next";

function normalizeWhen(when) {
  const parsed = new Date(when || "").getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(Date.now() + 1_000, parsed);
}

export function createBackgroundRuntime({
  chromeApi = chrome,
  globalScope = globalThis,
  sessionManager = createSessionManager(),
  capabilityCache = createCapabilityCache(),
  sidepanelManager = createSidepanelManager(),
  workspaceSummary = createWorkspaceSummary(),
  createApiClientFn = createApiClient,
  createQueueManagerFn = createQueueManager,
  createSyncManagerFn = createSyncManager,
  createHandoffManagerFn = createHandoffManager,
  createRouterFn = createRouter,
} = {}) {
  const apiClient = createApiClientFn({ sessionManager });
  const queueManager = createQueueManagerFn({
    onChange: () => void scheduleReplayAlarm(),
  });
  const syncManager = createSyncManagerFn({ apiClient, queueManager, sessionManager });
  const handoffManager = createHandoffManagerFn({ apiClient, sessionManager });
  const routeMessage = createRouterFn({
    apiClient,
    sessionManager,
    capabilityCache,
    queueManager,
    syncManager,
    handoffManager,
    sidepanelManager,
    workspaceSummary,
  });

  async function scheduleReplayAlarm() {
    try {
      const nextReplayAt = await queueManager.getNextReplayAt();
      chromeApi.alarms?.clear?.(REPLAY_EXACT_ALARM);
      if (!nextReplayAt) return;
      const when = normalizeWhen(nextReplayAt);
      if (!when) return;
      chromeApi.alarms?.create?.(REPLAY_EXACT_ALARM, { when });
    } catch (error) {
      logger.warn("Failed to schedule replay alarm", { error: error?.message });
    }
  }

  async function triggerReplay(source = "manual") {
    try {
      await hydrateAuthorityState(source);
    } catch (error) {
      logger.warn("Replay trigger failed", { source, error: error?.message });
    }
  }

  async function hydrateAuthorityState(source = "startup") {
    try {
      if (typeof handoffManager.resumePendingAuthAttempt === "function") {
        await handoffManager.resumePendingAuthAttempt();
      }
    } catch (error) {
      logger.warn("Pending auth attempt hydration failed", { source, error: error?.message });
    }
    try {
      const bootstrap = await apiClient.bootstrap();
      await capabilityCache.write(bootstrap?.data?.capabilities || bootstrap?.capabilities || null);
    } catch (error) {
      logger.warn("Bootstrap hydration skipped", { source, error: error?.message });
    }
    try {
      await syncManager.flush();
    } catch (error) {
      logger.warn("Sync flush failed", { source, error: error?.message });
    } finally {
      await scheduleReplayAlarm();
    }
  }

  function registerLifecycleHooks() {
    chromeApi.alarms?.create?.(REPLAY_PERIODIC_ALARM, { periodInMinutes: 5 });
    chromeApi.alarms?.onAlarm?.addListener((alarm) => {
      if (alarm?.name === REPLAY_PERIODIC_ALARM || alarm?.name === REPLAY_EXACT_ALARM) {
        void triggerReplay(alarm.name);
      }
    });

    chromeApi.runtime.onInstalled.addListener(() => {
      void triggerReplay("installed");
    });

    chromeApi.runtime.onStartup.addListener(() => {
      void triggerReplay("startup");
    });

    if (typeof globalScope.addEventListener === "function") {
      globalScope.addEventListener("online", () => {
        void triggerReplay("online");
      });
    }

    chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      Promise.resolve(routeMessage(message, sender))
        .then((result) => {
          void scheduleReplayAlarm();
          sendResponse(result);
        })
        .catch((error) => {
          logger.error("Message handler failed", { type: message?.type, error: error?.message, status: error?.status });
          sendResponse({
            ok: false,
            error: error?.message || "extension_runtime_error",
            status: error?.status || 500,
          });
        });
      return true;
    });
  }

  return {
    apiClient,
    sessionManager,
    capabilityCache,
    queueManager,
    syncManager,
    handoffManager,
    routeMessage,
    hydrateAuthorityState,
    registerLifecycleHooks,
    scheduleReplayAlarm,
    triggerReplay,
  };
}

if (typeof chrome !== "undefined" && chrome?.runtime?.onMessage) {
  const runtime = createBackgroundRuntime();
  runtime.registerLifecycleHooks();
  void runtime.hydrateAuthorityState();
}
