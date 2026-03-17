import { MESSAGE_TYPES } from "../shared/messages.js";

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

export function createPopupActions() {
  return {
    openSidepanel() {
      return sendMessage(MESSAGE_TYPES.OPEN_SIDEPANEL);
    },
    openSignIn() {
      return sendMessage(MESSAGE_TYPES.OPEN_APP_SIGN_IN);
    },
    syncNow() {
      return sendMessage(MESSAGE_TYPES.SYNC_NOW);
    },
    async workInEditor() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return sendMessage(MESSAGE_TYPES.WORK_IN_EDITOR, {
        url: tab?.url || "",
        title: tab?.title || "",
        selected_text: "",
        metadata: {
          url: tab?.url || "",
          canonical_url: tab?.url || "",
          title: tab?.title || "",
          hostname: (() => {
            try {
              return new URL(tab?.url || "").hostname;
            } catch {
              return "";
            }
          })(),
        },
        locator: {},
      });
    },
    getStatus() {
      return sendMessage(MESSAGE_TYPES.GET_STATUS);
    },
  };
}

