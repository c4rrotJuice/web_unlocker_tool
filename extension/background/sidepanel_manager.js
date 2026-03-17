const SIDEPANEL_COLLAPSED_KEY = "sidepanel_collapsed";

async function getActiveTab(tabId) {
  if (Number.isInteger(tabId)) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab || null;
}

export function createSidepanelManager() {
  let sidePanelRuntimeOpen = false;

  chrome.sidePanel?.onPanelOpened?.addListener(() => {
    sidePanelRuntimeOpen = true;
  });

  chrome.sidePanel?.onPanelClosed?.addListener(() => {
    sidePanelRuntimeOpen = false;
  });

  return {
    async openSidePanel(tabId, windowId) {
      if (!chrome.sidePanel?.open || !chrome.sidePanel?.setOptions) {
        return { ok: false, error: "sidepanel_unsupported" };
      }
      const activeTab = await getActiveTab(tabId);
      const targetWindowId = Number.isInteger(activeTab?.windowId) ? activeTab.windowId : null;
      const enablePromise = chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
      const openPromise = chrome.sidePanel.open({ windowId: targetWindowId ?? windowId });
      await Promise.all([enablePromise, openPromise]);
      await chrome.storage.local.set({ [SIDEPANEL_COLLAPSED_KEY]: false });
      sidePanelRuntimeOpen = true;
      return { ok: true };
    },
    async collapseSidePanel() {
      if (!chrome.sidePanel?.setOptions) {
        return { ok: false, error: "sidepanel_unsupported" };
      }
      await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: false });
      await chrome.storage.local.set({ [SIDEPANEL_COLLAPSED_KEY]: true });
      sidePanelRuntimeOpen = false;
      return { ok: true };
    },
    async getState() {
      const payload = await chrome.storage.local.get({ [SIDEPANEL_COLLAPSED_KEY]: false });
      return {
        is_open: sidePanelRuntimeOpen,
        is_collapsed: Boolean(payload[SIDEPANEL_COLLAPSED_KEY]),
      };
    },
  };
}

