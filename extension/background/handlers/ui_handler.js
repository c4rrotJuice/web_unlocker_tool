// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { STORAGE_KEYS } from "../../shared/constants/storage_keys.js";
export function createUiHandler(options = {}) {
    const typedOptions = options;
    const chromeApi = typedOptions.chromeApi;
    const panelStateByTarget = new Map();
    const toggleInFlightByTarget = new Map();
    let storageHydration = null;
    async function hydratePersistedPanelState() {
        if (storageHydration) {
            return storageHydration;
        }
        storageHydration = (async () => {
            const storage = chromeApi?.storage?.local;
            if (typeof storage?.get !== "function") {
                return;
            }
            const result = await storage.get({ [STORAGE_KEYS.SIDEPANEL_STATE]: {} });
            const snapshot = result?.[STORAGE_KEYS.SIDEPANEL_STATE];
            if (!snapshot || typeof snapshot !== "object") {
                return;
            }
            for (const [key, isOpen] of Object.entries(snapshot)) {
                if (isOpen === true) {
                    panelStateByTarget.set(key, true);
                }
            }
        })();
        return storageHydration;
    }
    function getTargetKey(context) {
        if (Number.isInteger(context?.tabId)) {
            return `tab:${context.tabId}`;
        }
        if (Number.isInteger(context?.windowId)) {
            return `window:${context.windowId}`;
        }
        return null;
    }
    async function persistPanelState() {
        const storage = chromeApi?.storage?.local;
        if (typeof storage?.set !== "function") {
            return;
        }
        const snapshot = Object.fromEntries(panelStateByTarget.entries());
        await storage.set({ [STORAGE_KEYS.SIDEPANEL_STATE]: snapshot });
    }
    async function updatePanelState(context, isOpen) {
        const key = getTargetKey(context);
        if (!key) {
            return;
        }
        await hydratePersistedPanelState();
        if (isOpen) {
            panelStateByTarget.set(key, true);
        }
        else {
            panelStateByTarget.delete(key);
        }
        await persistPanelState();
    }
    async function isPanelOpen(context) {
        const key = getTargetKey(context);
        if (!key) {
            return false;
        }
        await hydratePersistedPanelState();
        return panelStateByTarget.get(key) === true;
    }
    function runWithTargetLock(context, run) {
        const key = getTargetKey(context) || "__global__";
        const inFlight = toggleInFlightByTarget.get(key);
        if (inFlight) {
            return inFlight;
        }
        const nextRun = Promise.resolve()
            .then(run)
            .finally(() => {
            toggleInFlightByTarget.delete(key);
        });
        toggleInFlightByTarget.set(key, nextRun);
        return nextRun;
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
        await updatePanelState(context, true);
        return createOkResult({
            opened: true,
            target: Number.isInteger(tabId) ? "sender_tab" : "active_window",
        });
    }
    async function closeSidepanelForContext(context) {
        const tabId = context?.tabId;
        if (Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.close === "function") {
            await chromeApi.sidePanel.close({ tabId });
            await updatePanelState(context, false);
            return createOkResult({ opened: false, target: "sender_tab" });
        }
        if (Number.isInteger(context?.windowId) && typeof chromeApi?.sidePanel?.close === "function") {
            await chromeApi.sidePanel.close({ windowId: context.windowId });
            await updatePanelState(context, false);
            return createOkResult({ opened: false, target: "active_window" });
        }
        if (Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.setOptions === "function") {
            await chromeApi.sidePanel.setOptions({ tabId, enabled: false });
            await updatePanelState(context, false);
            return createOkResult({ opened: false, target: "sender_tab" });
        }
        return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "ui.open_sidepanel toggle-close is not implemented in this browser.");
    }
    async function toggleSidepanelForContext(context, requestId) {
        return runWithTargetLock(context, async () => {
            const result = await (await isPanelOpen(context)
                ? closeSidepanelForContext(context)
                : openSidepanelForContext(context));
            return {
                ...result,
                requestId,
            };
        });
    }
    function registerPanelStateListeners() {
        const onOpened = chromeApi?.sidePanel?.onOpened;
        if (typeof onOpened?.addListener === "function") {
            onOpened.addListener((event = {}) => {
                void updatePanelState({
                    tabId: Number.isInteger(event?.tabId) ? event.tabId : null,
                    windowId: Number.isInteger(event?.windowId) ? event.windowId : null,
                }, true);
            });
        }
        const onClosed = chromeApi?.sidePanel?.onClosed;
        if (typeof onClosed?.addListener === "function") {
            onClosed.addListener((event = {}) => {
                void updatePanelState({
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
            return runWithTargetLock(context, async () => {
                const result = await openSidepanelForContext(context);
                return {
                    ...result,
                    requestId: request.requestId,
                };
            });
        },
    };
}
