import { MESSAGE_TYPES } from "../shared/messages.js";

export function sendMessage(type, payload = {}) {
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

export function createSidepanelStore() {
  return {
    async load() {
      const [status, summary] = await Promise.all([
        sendMessage(MESSAGE_TYPES.GET_STATUS),
        sendMessage(MESSAGE_TYPES.GET_WORKSPACE_SUMMARY),
      ]);
      return {
        status: status?.data || {},
        summary: summary?.data || {},
      };
    },
    async syncNow() {
      return sendMessage(MESSAGE_TYPES.SYNC_NOW);
    },
    async openSignIn() {
      return sendMessage(MESSAGE_TYPES.OPEN_APP_SIGN_IN);
    },
    async openEditorFromCurrentPage() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || "";
      const selection = await sendMessage(MESSAGE_TYPES.GET_LAST_SELECTION);
      return sendMessage(MESSAGE_TYPES.WORK_IN_EDITOR, {
        url,
        title: tab?.title || "",
        selected_text: selection?.data?.text || "",
        metadata: {
          url,
          canonical_url: url,
          title: tab?.title || "",
          hostname: (() => {
            try {
              return new URL(url).hostname;
            } catch {
              return "";
            }
          })(),
        },
        locator: {},
      });
    },
    async openDashboard() {
      return sendMessage(MESSAGE_TYPES.OPEN_DASHBOARD);
    },
    async resumeEditorDraft(id) {
      return sendMessage(MESSAGE_TYPES.RESUME_EDITOR_DRAFT, { id });
    },
    async removeLocalDraft(id) {
      return sendMessage(MESSAGE_TYPES.REMOVE_LOCAL_DRAFT, { id });
    },
    async updateNote(id, patch) {
      return sendMessage(MESSAGE_TYPES.UPDATE_NOTE, { id, patch });
    },
    async deleteNote(id) {
      return sendMessage(MESSAGE_TYPES.DELETE_NOTE, { id });
    },
  };
}
