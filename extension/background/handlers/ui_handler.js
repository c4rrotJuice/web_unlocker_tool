// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
export function createUiHandler(options = {}) {
    const typedOptions = options;
    const chromeApi = typedOptions.chromeApi;
    return {
        ping(request) {
            return createOkResult({
                ack: true,
                surface: request.payload.surface,
                timestamp: new Date().toISOString(),
            }, request.requestId);
        },
        async openSidepanel(request, sender = {}) {
            const typedSender = sender;
            if (!chromeApi?.sidePanel?.open) {
                return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "ui.open_sidepanel is not implemented in this phase.", request.requestId, { reason: "sidePanel API unavailable" });
            }
            const senderWindowId = typedSender?.tab?.windowId;
            if (Number.isInteger(senderWindowId)) {
                await chromeApi.sidePanel.open({ windowId: senderWindowId });
                return createOkResult({ opened: true, target: "sender_window" }, request.requestId);
            }
            if (typeof chromeApi?.tabs?.query !== "function") {
                return createErrorResult(ERROR_CODES.INVALID_CONTEXT, "Unable to resolve an active browser window for the side panel.", request.requestId);
            }
            const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
            const windowId = tabs?.[0]?.windowId;
            if (!Number.isInteger(windowId)) {
                return createErrorResult(ERROR_CODES.INVALID_CONTEXT, "No active browser window was available for the side panel.", request.requestId);
            }
            await chromeApi.sidePanel.open({ windowId });
            return createOkResult({ opened: true, target: "active_window" }, request.requestId);
        },
    };
}
