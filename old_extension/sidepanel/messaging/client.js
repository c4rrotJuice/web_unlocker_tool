import { MESSAGE_NAMES } from "../../shared/constants/message_names.js";
import { sendRuntimeMessage } from "../../shared/utils/runtime_message.js";

export function createSidepanelClient(chromeApi = globalThis.chrome) {
  return {
    restoreSession() {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.AUTH_RESTORE_SESSION });
    },
    getAuthState() {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.AUTH_GET_STATE });
    },
    getBootstrapState() {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.BOOTSTRAP_GET_STATE });
    },
    listCitations(payload = {}) {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.SIDEPANEL_LIST_CITATIONS, payload });
    },
    listNotes(payload = {}) {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.SIDEPANEL_LIST_NOTES, payload });
    },
    openEditor() {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR });
    },
    openDashboard() {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD });
    },
    signOut() {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.AUTH_SIGN_OUT });
    },
    createNote(payload) {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.CAPTURE_CREATE_NOTE, payload });
    },
    saveCitationState(payload) {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.CITATION_SAVE_STATE, payload });
    },
    renderCitation(payload) {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.CITATION_RENDER, payload });
    },
    workInEditor(payload) {
      return sendRuntimeMessage(chromeApi, { type: MESSAGE_NAMES.WORK_IN_EDITOR, payload });
    },
  };
}
