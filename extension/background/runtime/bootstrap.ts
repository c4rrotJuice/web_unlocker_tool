import { API_ORIGIN } from "../../shared/constants/endpoints.ts";
import { MESSAGE_NAMES } from "../../shared/constants/message_names.ts";
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.ts";
import { createLogger } from "../../shared/utils/logger.ts";
import { createApiClient } from "../api/client.ts";
import { createCaptureApi } from "../api/captures.ts";
import { createCitationApi } from "../api/citations.ts";
import { createWorkInEditorApi } from "../api/work_in_editor.ts";
import { createSessionStore } from "../auth/session_store.ts";
import {
  createAuthHandler,
  createBootstrapHandler,
  createCaptureHandler,
  createCitationHandler,
  createEditorHandler,
  createSidepanelHandler,
  createUiHandler,
} from "../handlers/index.ts";
import { createBackgroundRouter } from "../messaging/router.ts";
import { createTabOpener } from "../navigation/tabs.ts";
import { createBackgroundStateStore } from "../state/index.ts";
import { createCitationStateStore } from "../state/citation_state.ts";

const logger = createLogger("background");
export function createBackgroundRuntime(deps = {}) {
  const typedDeps: any = deps;
  const chromeApi = typedDeps.chromeApi || globalThis.chrome;
  const sessionStore = typedDeps.sessionStore || createSessionStore({ chromeApi });
  const stateStore = typedDeps.stateStore || createBackgroundStateStore();
  const citationStateStore = typedDeps.citationStateStore || createCitationStateStore();
  const apiClient = typedDeps.apiClient || createApiClient({
    baseUrl: typedDeps.baseUrl || API_ORIGIN,
    fetchImpl: typedDeps.fetchImpl || globalThis.fetch,
    getAccessToken: () => sessionStore.getToken(),
  });
  const captureApi = typedDeps.captureApi || createCaptureApi(apiClient);
  const citationApi = typedDeps.citationApi || createCitationApi(apiClient);
  const workInEditorApi = typedDeps.workInEditorApi || createWorkInEditorApi(apiClient);
  const tabOpener = typedDeps.tabOpener || createTabOpener({ chromeApi, stateStore });
  const bootstrapHandler = typedDeps.bootstrapHandler || createBootstrapHandler({
    apiClient,
    sessionStore,
    stateStore,
  });
  const handlers = typedDeps.handlers || {
    auth: createAuthHandler({
      apiClient,
      sessionStore,
      stateStore,
      bootstrapHandler,
      chromeApi,
      baseUrl: typedDeps.baseUrl || API_ORIGIN,
      pollIntervalMs: typedDeps.pollIntervalMs,
      maxPollAttempts: typedDeps.maxPollAttempts,
    }),
    bootstrap: bootstrapHandler,
    sidepanel: createSidepanelHandler({
      apiClient,
      stateStore,
      tabOpener,
    }),
    capture: createCaptureHandler({ captureApi }),
    citation: createCitationHandler({ citationApi, citationStateStore }),
    editor: createEditorHandler({ workInEditorApi, tabOpener }),
    ui: createUiHandler({ chromeApi }),
  };
  const router = typedDeps.router || createBackgroundRouter({
    chromeApi,
    handlers,
  });

  return {
    chromeApi,
    sessionStore,
    stateStore,
    apiClient,
    captureApi,
    citationApi,
    workInEditorApi,
    handlers,
    router,
    dispatch(message, sender = {}) {
      return router(message, sender);
    },
    async bootstrap() {
      logger.info("worker boot");
      const restore = await handlers.auth.restoreSession({
        type: MESSAGE_NAMES.AUTH_STATUS_GET,
        requestId: "worker-bootstrap",
        payload: { surface: "background" },
      });
      if (restore.ok === false) {
        return restore;
      }
      return createOkResult({
        alive: true,
        messageTypes: Object.values(MESSAGE_NAMES),
        auth: stateStore.getState(),
      }, "worker-bootstrap");
    },
    registerLifecycleHooks() {
      if (!chromeApi?.runtime?.onMessage?.addListener) {
        logger.warn("runtime.onMessage is unavailable");
        return false;
      }

      logger.info("registering listeners");

      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        Promise.resolve(router(message, sender))
          .then((result) => sendResponse?.(result))
          .catch((error) => {
            sendResponse?.(createErrorResult(
              ERROR_CODES.UNEXPECTED_ERROR,
              error?.message || "Unhandled background error.",
              message?.requestId,
            ));
          });
        return true;
      });

      if (typeof chromeApi.runtime.onInstalled?.addListener === "function") {
        chromeApi.runtime.onInstalled.addListener(() => {
          logger.info("runtime installed");
        });
      }

      if (typeof chromeApi.runtime.onStartup?.addListener === "function") {
        chromeApi.runtime.onStartup.addListener(() => {
          logger.info("runtime startup");
        });
      }

      return true;
    },
  };
}
