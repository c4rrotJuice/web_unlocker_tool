import { MESSAGE_NAMES } from "../shared/constants/message_names.js";
import { STORAGE_KEYS } from "../shared/constants/storage_keys.js";
import { ERROR_CODES } from "../shared/types/messages.js";
import { createApiClient } from "./api/client.js";
import { createBootstrapApi } from "./api/bootstrap_api.js";
import { createCaptureApi } from "./api/capture_api.js";
import { createCitationApi } from "./api/citation_api.js";
import { createWorkInEditorApi } from "./api/work_in_editor_api.js";
import { createAuthHandler } from "./handlers/auth_handler.js";
import { createBootstrapHandler } from "./handlers/bootstrap_handler.js";
import { createCaptureHandler } from "./handlers/capture_handler.js";
import { createCitationHandler } from "./handlers/citation_handler.js";
import { createEditorHandler } from "./handlers/editor_handler.js";
import { createSurfaceHandler } from "./handlers/surface_handler.js";
import { createSessionStore } from "./auth/session_store.js";
import { createBackgroundStateStore } from "./state/index.js";
import { createCitationStateStore } from "./state/citation_state.js";
import { createBackgroundRouter } from "./router.js";

export const REPLAY_EXACT_ALARM = "writior-replay-exact";
export const REPLAY_PERIODIC_ALARM = "writior-replay-periodic";

export function createBackgroundRuntime(deps = {}) {
  const chromeApi = deps.chromeApi || globalThis.chrome;
  const stateStore = deps.stateStore || createBackgroundStateStore();
  const citationStateStore = deps.citationStateStore || createCitationStateStore();
  function notifyCitationChange(nextState = citationStateStore.getState()) {
    if (!chromeApi?.runtime?.sendMessage) {
      return;
    }
    try {
      chromeApi.runtime.sendMessage({
        type: MESSAGE_NAMES.CITATION_STATE_CHANGED,
        payload: { citation: nextState },
      });
    } catch {
      // best effort only
    }
  }
  function notifySidepanelChange(nextState = stateStore.getState()) {
    if (!chromeApi?.runtime?.sendMessage) {
      return;
    }
    try {
      chromeApi.runtime.sendMessage({
        type: MESSAGE_NAMES.SIDEPANEL_STATE_CHANGED,
        payload: { auth: nextState },
      });
    } catch {
      // best effort only
    }
  }
  const sessionStore = deps.sessionStore || createSessionStore({ chromeApi });
  const apiClient = deps.apiClient || createApiClient({
    baseUrl: deps.baseUrl,
    fetchImpl: deps.fetchImpl,
    getAccessToken: () => sessionStore.getToken(),
  });
  const bootstrapApi = deps.bootstrapApi || createBootstrapApi(apiClient);
  const captureApi = deps.captureApi || createCaptureApi(apiClient);
  const citationApi = deps.citationApi || createCitationApi(apiClient);
  const workInEditorApi = deps.workInEditorApi || createWorkInEditorApi(apiClient);
  const bootstrapHandler = deps.bootstrapHandler || createBootstrapHandler({
    apiClient: bootstrapApi,
    sessionStore,
    stateStore,
  });
  const citationHandler = deps.citationHandler || createCitationHandler({
    citationApi,
    citationStateStore,
    notifyCitationChange,
  });
  const editorHandler = deps.editorHandler || createEditorHandler({
    workInEditorApi,
    chromeApi,
  });
  const captureHandler = deps.captureHandler || createCaptureHandler({
    captureApi,
    stateStore,
    citationStateStore,
    notifyCitationChange,
    notifySidepanelChange,
    chromeApi,
  });
  const authHandler = deps.authHandler || createAuthHandler({
    apiClient,
    sessionStore,
    stateStore,
    bootstrapHandler,
  });
  const surfaceHandler = deps.surfaceHandler || createSurfaceHandler({
    chromeApi,
    stateStore,
    authHandler,
    apiClient,
  });
  const router = deps.router || createBackgroundRouter({
    authHandler,
    bootstrapHandler,
    captureHandler,
    citationHandler,
    editorHandler,
    surfaceHandler,
  });

  return {
    deps,
    chromeApi,
    stateStore,
    citationStateStore,
    sessionStore,
    apiClient,
    bootstrapApi,
    captureApi,
    citationApi,
    workInEditorApi,
    bootstrapHandler,
    citationHandler,
    editorHandler,
    surfaceHandler,
    captureHandler,
    authHandler,
    router,
    async dispatch(message, sender) {
      return router(message, sender);
    },
    async bootstrap() {
      const result = await authHandler.restoreSession();
      notifyCitationChange();
      notifySidepanelChange();
      return result;
    },
    registerLifecycleHooks() {
      if (!chromeApi?.runtime?.onMessage?.addListener) {
        return false;
      }
      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        Promise.resolve(router(message, sender))
          .then((result) => sendResponse?.(result))
          .catch((error) => sendResponse?.({
            ok: false,
            status: "error",
            error: {
              code: ERROR_CODES.NOT_IMPLEMENTED,
              message: error?.message || "Unhandled background error.",
            },
          }));
        return true;
      });
      if (typeof chromeApi.runtime.onInstalled?.addListener === "function") {
        chromeApi.runtime.onInstalled.addListener(() => {
          void authHandler.restoreSession();
        });
      }
      if (typeof chromeApi.runtime.onStartup?.addListener === "function") {
        chromeApi.runtime.onStartup.addListener(() => {
          void authHandler.restoreSession();
        });
      }
      void authHandler.restoreSession();
      return true;
    },
    getMessageNames() {
      return MESSAGE_NAMES;
    },
    getStorageKeys() {
      return STORAGE_KEYS;
    },
  };
}

export { createBackgroundRouter, createRouter } from "./router.js";
