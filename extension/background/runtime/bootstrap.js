import { API_ORIGIN } from "../../shared/constants/endpoints.js";
import { MESSAGE_NAMES } from "../../shared/constants/message_names.js";
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { createLogger } from "../../shared/utils/logger.js";
import { createApiClient } from "../api/client.js";
import { createCaptureApi } from "../api/captures.js";
import { createSessionStore } from "../auth/session_store.js";
import { createAuthHandler, createBootstrapHandler, createCaptureHandler, createEditorHandler, createUiHandler, } from "../handlers/index.js";
import { createBackgroundRouter } from "../messaging/router.js";
import { createBackgroundStateStore } from "../state/index.js";
const logger = createLogger("background");
export function createBackgroundRuntime(deps = {}) {
    const typedDeps = deps;
    const chromeApi = typedDeps.chromeApi || globalThis.chrome;
    const sessionStore = typedDeps.sessionStore || createSessionStore({ chromeApi });
    const stateStore = typedDeps.stateStore || createBackgroundStateStore();
    const apiClient = typedDeps.apiClient || createApiClient({
        baseUrl: typedDeps.baseUrl || API_ORIGIN,
        fetchImpl: typedDeps.fetchImpl || globalThis.fetch,
        getAccessToken: () => sessionStore.getToken(),
    });
    const captureApi = typedDeps.captureApi || createCaptureApi(apiClient);
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
        capture: createCaptureHandler({ captureApi }),
        editor: createEditorHandler(),
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
                    sendResponse?.(createErrorResult(ERROR_CODES.UNEXPECTED_ERROR, error?.message || "Unhandled background error.", message?.requestId));
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
