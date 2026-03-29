// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { API_ORIGIN } from "../../shared/constants/endpoints.js";
import { MESSAGE_NAMES } from "../../shared/constants/message_names.js";
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { createLogger } from "../../shared/utils/logger.js";
import { createApiClient } from "../api/client.js";
import { createCaptureApi } from "../api/captures.js";
import { createCitationApi } from "../api/citations.js";
import { createWorkInEditorApi } from "../api/work_in_editor.js";
import { createAuthStateStorage } from "../auth/auth_state_store.js";
import { createSessionStore } from "../auth/session_store.js";
import { createSessionManager } from "../auth/session_manager.js";
import { createAuthHandler, createBootstrapHandler, createCaptureHandler, createCitationHandler, createEditorHandler, createSidepanelHandler, createUiHandler, } from "../handlers/index.js";
import { createBackgroundRouter } from "../messaging/router.js";
import { createTabOpener } from "../navigation/tabs.js";
import { createBackgroundStateStore } from "../state/index.js";
import { createCitationStateStore } from "../state/citation_state.js";
const logger = createLogger("background");
export function createBackgroundRuntime(deps = {}) {
    const typedDeps = deps;
    const chromeApi = typedDeps.chromeApi || globalThis.chrome;
    const sessionStore = typedDeps.sessionStore || createSessionStore({ chromeApi });
    const authStateStorage = typedDeps.authStateStorage || createAuthStateStorage({ chromeApi });
    const stateStore = typedDeps.stateStore || createBackgroundStateStore();
    const citationStateStore = typedDeps.citationStateStore || createCitationStateStore(undefined, { chromeApi });
    let sessionManager = typedDeps.sessionManager || null;
    const apiClient = typedDeps.apiClient || createApiClient({
        baseUrl: typedDeps.baseUrl || API_ORIGIN,
        fetchImpl: typedDeps.fetchImpl || globalThis.fetch,
        getAccessToken: () => sessionManager?.getAccessToken?.() || null,
        refreshAccessToken: () => sessionManager?.refreshAccessToken?.() || null,
    });
    sessionManager = sessionManager || createSessionManager({
        apiClient,
        sessionStore,
        stateStore,
        authStateStorage,
        chromeApi,
        refreshLeadMs: typedDeps.refreshLeadMs,
        retryDelayMs: typedDeps.retryDelayMs,
    });
    const captureApi = typedDeps.captureApi || createCaptureApi(apiClient);
    const citationApi = typedDeps.citationApi || createCitationApi(apiClient);
    const workInEditorApi = typedDeps.workInEditorApi || createWorkInEditorApi(apiClient);
    const tabOpener = typedDeps.tabOpener || createTabOpener({ chromeApi, stateStore });
    const bootstrapHandler = typedDeps.bootstrapHandler || createBootstrapHandler({
        apiClient,
        sessionStore,
        sessionManager,
        stateStore,
    });
    const handlers = typedDeps.handlers || {
        auth: createAuthHandler({
            apiClient,
            sessionStore,
            sessionManager,
            stateStore,
            citationStateStore,
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
    let listenersRegistered = false;
    async function runBootstrap(reason = "worker-bootstrap") {
        logger.info("worker boot", { reason });
        if (typeof citationStateStore.hydrate === "function") {
            await citationStateStore.hydrate();
        }
        const restore = await handlers.auth.restoreSession({
            type: MESSAGE_NAMES.AUTH_STATUS_GET,
            requestId: reason,
            payload: { surface: "background" },
        });
        if (restore.ok === false) {
            return restore;
        }
        return createOkResult({
            alive: true,
            messageTypes: Object.values(MESSAGE_NAMES),
            auth: stateStore.getState(),
            citation: citationStateStore.getState(),
        }, reason);
    }
    function bootstrapFromLifecycle(reason) {
        void runBootstrap(reason).catch((error) => {
            logger.warn("worker bootstrap failed", {
                reason,
                message: error?.message || String(error),
            });
        });
    }
    return {
        chromeApi,
        sessionStore,
        sessionManager,
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
            return runBootstrap("worker-bootstrap");
        },
        registerLifecycleHooks() {
            if (!chromeApi?.runtime?.onMessage?.addListener) {
                logger.warn("runtime.onMessage is unavailable");
                return false;
            }
            if (listenersRegistered) {
                return true;
            }
            listenersRegistered = true;
            logger.info("registering listeners");
            chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
                Promise.resolve(router(message, sender))
                    .then((result) => sendResponse?.(result))
                    .catch((error) => {
                    sendResponse?.(createErrorResult(ERROR_CODES.UNEXPECTED_ERROR, error?.message || "Unhandled background error.", message?.requestId));
                });
                return true;
            });
            handlers.ui?.registerPanelStateListeners?.();
            handlers.ui?.registerActionClickHandler?.();
            if (typeof chromeApi.runtime.onInstalled?.addListener === "function") {
                chromeApi.runtime.onInstalled.addListener(() => {
                    logger.info("runtime installed");
                    bootstrapFromLifecycle("worker-installed");
                });
            }
            if (typeof chromeApi.runtime.onStartup?.addListener === "function") {
                chromeApi.runtime.onStartup.addListener(() => {
                    logger.info("runtime startup");
                    bootstrapFromLifecycle("worker-startup");
                });
            }
            if (typeof chromeApi.alarms?.onAlarm?.addListener === "function") {
                chromeApi.alarms.onAlarm.addListener((alarm) => {
                    void sessionManager.onAlarm(alarm).catch((error) => {
                        logger.warn("auth refresh alarm failed", {
                            message: error?.message || String(error),
                        });
                    });
                });
            }
            return true;
        },
    };
}
