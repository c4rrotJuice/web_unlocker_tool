import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { resolveCanonicalUrl } from "./app_urls.js";
export function createTabOpener(options = {}) {
    const { chromeApi, stateStore } = options;
    return {
        async open(urlOrPath, requestId, destination = "app") {
            if (!chromeApi?.tabs?.create) {
                return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "Tab creation is unavailable.", requestId);
            }
            const url = resolveCanonicalUrl(urlOrPath, stateStore);
            if (!url) {
                return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Canonical ${destination} URL is unavailable.`, requestId);
            }
            await chromeApi.tabs.create({ url, active: true });
            return createOkResult({ opened: true, destination, url }, requestId);
        },
    };
}
