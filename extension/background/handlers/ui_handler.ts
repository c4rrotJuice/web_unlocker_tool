import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.ts";

export function createUiHandler(options = {}) {
  const typedOptions: any = options;
  const chromeApi = typedOptions.chromeApi;
  const panelStateByTab = new Map();

  async function resolveContext(sender = {}) {
    const typedSender: any = sender;
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

  return {
    ping(request) {
      return createOkResult({
        ack: true,
        surface: request.payload.surface,
        timestamp: new Date().toISOString(),
      }, request.requestId);
    },
    async openSidepanel(request, sender = {}) {
      if (!chromeApi?.sidePanel?.open) {
        return createErrorResult(
          ERROR_CODES.NOT_IMPLEMENTED,
          "ui.open_sidepanel is not implemented in this phase.",
          request.requestId,
          { reason: "sidePanel API unavailable" },
        );
      }

      const context = await resolveContext(sender);
      if (!Number.isInteger(context?.windowId)) {
        return createErrorResult(
          ERROR_CODES.INVALID_CONTEXT,
          "Unable to resolve an active browser window for the side panel.",
          request.requestId,
        );
      }
      const toggleMode = request?.payload?.mode === "toggle";
      const tabId = context.tabId;
      const currentOpen = Number.isInteger(tabId) ? panelStateByTab.get(tabId) === true : false;
      if (toggleMode && currentOpen && Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.setOptions === "function") {
        await chromeApi.sidePanel.setOptions({ tabId, enabled: false });
        panelStateByTab.set(tabId, false);
        return createOkResult({ opened: false, target: "sender_tab" }, request.requestId);
      }
      if (Number.isInteger(tabId) && typeof chromeApi?.sidePanel?.setOptions === "function") {
        await chromeApi.sidePanel.setOptions({ tabId, enabled: true, path: "sidepanel/index.html" });
      }
      await chromeApi.sidePanel.open({ windowId: context.windowId });
      if (Number.isInteger(tabId)) {
        panelStateByTab.set(tabId, true);
      }
      return createOkResult({ opened: true, target: Number.isInteger(tabId) ? "sender_tab" : "active_window" }, request.requestId);
    },
  };
}
