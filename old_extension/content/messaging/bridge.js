import { sendRuntimeMessage } from "../../shared/utils/runtime_message.js";
import { MESSAGE_NAMES } from "../../shared/constants/message_names.js";

export function createContentBridge({ chromeApi = globalThis.chrome } = {}) {
  function send(type, payload = undefined) {
    return sendRuntimeMessage(chromeApi, { type, payload });
  }

  return {
    send,
    getAuthState() {
      return send(MESSAGE_NAMES.AUTH_GET_STATE);
    },
    captureCitation(payload) {
      return send(MESSAGE_NAMES.CAPTURE_CREATE_CITATION, payload);
    },
    captureQuote(payload) {
      return send(MESSAGE_NAMES.CAPTURE_CREATE_QUOTE, payload);
    },
    captureNote(payload) {
      return send(MESSAGE_NAMES.CAPTURE_CREATE_NOTE, payload);
    },
    workInEditor(payload) {
      return send(MESSAGE_NAMES.WORK_IN_EDITOR, payload);
    },
  };
}
