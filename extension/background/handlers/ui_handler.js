// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
export function createUiHandler(options = {}) {
    const typedOptions = options;
    const chromeApi = typedOptions.chromeApi;
    const panelStateByTarget = new Map();
    function getTargetKey(context) {
        if (Number.isInteger(context?.tabId)) {
            return `tab:${context.tabId}`;
        }
        if (Number.isInteger(context?.windowId)) {
            return `window:${context.windowId}`;
        }
        return null;
    }
    function updatePanelState(context, isOpen) {
        const key = getTargetKey(context);
        if (!key) {
            return;
        }
        panelStateByTarget.set(key, isOpen);
    }
    function isPanelOpen(context) {
        const key = getTargetKey(context);
        if (!key) {
            return false;
        }
        return panelStateByTarget.get(key) === true;
    }
    async function resolveContext(sender = {}) {
        const typedSender = sender;
        const senderWindowId = typedSender?.tab?.windowId;
        const senderTabId = typedSender?.tab?.id;
        if (Number.isInteger(senderWindowId)) {
            return {
                windowId: senderWindowId,
                tabId: Number.isInteger(senderTabId) ? senderTabId : null,
            };
        }
        if (typeof chromeApi?.tabs?.query !== "function") {
            return null;
        }
        const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs?.[0] || null;
        return {
            windowId: activeTab?.windowId,
            tabId: Number.isInteger(activeTab?.id) ? activeTab.id : null,
        };
    }
    async function openSidepanelForContext(context) {
        const tabId = context?.tabId;
        if (Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.setOptions === "function") {
            await chromeApi.sidePanel.setOptions({ tabId, enabled: true, path: "sidepanel/index.html" });
        }
        if (Number.isInteger(tabId)) {
            await chromeApi.sidePanel.open({ tabId });
        }
        else {
            await chromeApi.sidePanel.open({ windowId: context.windowId });
        }
        updatePanelState(context, true);
        return createOkResult({
            opened: true,
            target: Number.isInteger(tabId) ? "sender_tab" : "active_window",
        });
    }
    async function closeSidepanelForContext(context) {
        const tabId = context?.tabId;
        if (Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.close === "function") {
            await chromeApi.sidePanel.close({ tabId });
            updatePanelState(context, false);
            return createOkResult({ opened: false, target: "sender_tab" });
        }
        if (Number.isInteger(context?.windowId) && typeof chromeApi?.sidePanel?.close === "function") {
            await chromeApi.sidePanel.close({ windowId: context.windowId });
            updatePanelState(context, false);
            return createOkResult({ opened: false, target: "active_window" });
        }
        if (Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.setOptions === "function") {
            await chromeApi.sidePanel.setOptions({ tabId, enabled: false });
            updatePanelState(context, false);
            return createOkResult({ opened: false, target: "sender_tab" });
        }
        return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "ui.open_sidepanel toggle-close is not implemented in this browser.");
    }
    async function toggleSidepanelForContext(context, requestId) {
        const result = isPanelOpen(context)
            ? await closeSidepanelForContext(context)
            : await openSidepanelForContext(context);
        return {
            ...result,
            requestId,
        };
    }
    function registerPanelStateListeners() {
        const onOpened = chromeApi?.sidePanel?.onOpened;
        if (typeof onOpened?.addListener === "function") {
            onOpened.addListener((event = {}) => {
                updatePanelState({
                    tabId: Number.isInteger(event?.tabId) ? event.tabId : null,
                    windowId: Number.isInteger(event?.windowId) ? event.windowId : null,
                }, true);
            });
        }
        const onClosed = chromeApi?.sidePanel?.onClosed;
        if (typeof onClosed?.addListener === "function") {
            onClosed.addListener((event = {}) => {
                updatePanelState({
                    tabId: Number.isInteger(event?.tabId) ? event.tabId : null,
                    windowId: Number.isInteger(event?.windowId) ? event.windowId : null,
                }, false);
            });
        }
    }
    function registerActionClickHandler() {
        if (typeof chromeApi?.action?.onClicked?.addListener !== "function") {
            return false;
        }
        chromeApi.action.onClicked.addListener((tab = {}) => {
            void toggleSidepanelForContext({
                tabId: Number.isInteger(tab?.id) ? tab.id : null,
                windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null,
            }, "action-click").catch(() => { });
        });
        return true;
    }
    return {
        registerPanelStateListeners,
        registerActionClickHandler,
        ping(request) {
            return createOkResult({
                ack: true,
                surface: request.payload.surface,
                timestamp: new Date().toISOString(),
            }, request.requestId);
        },
        async openSidepanel(request, sender = {}) {
            if (!chromeApi?.sidePanel?.open) {
                return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "ui.open_sidepanel is not implemented in this phase.", request.requestId, { reason: "sidePanel API unavailable" });
            }
            const context = await resolveContext(sender);
            if (!Number.isInteger(context?.windowId)) {
                return createErrorResult(ERROR_CODES.INVALID_CONTEXT, "Unable to resolve an active browser window for the side panel.", request.requestId);
            }
            if (request?.payload?.mode === "toggle") {
                return toggleSidepanelForContext(context, request.requestId);
            }
            const result = await openSidepanelForContext(context);
            return {
                ...result,
                requestId: request.requestId,
            };
        },
    };
}
