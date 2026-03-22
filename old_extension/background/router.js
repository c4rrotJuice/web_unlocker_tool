import { ERROR_CODES, createErrorResult } from "../shared/types/messages.js";
import { MESSAGE_NAMES } from "../shared/constants/message_names.js";
import { validateInternalMessageRequest } from "../shared/contracts/validators.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const NO_PAYLOAD_TYPES = new Set([
  MESSAGE_NAMES.AUTH_GET_STATE,
  MESSAGE_NAMES.AUTH_RESTORE_SESSION,
  MESSAGE_NAMES.AUTH_SIGN_OUT,
  MESSAGE_NAMES.BOOTSTRAP_GET_STATE,
  MESSAGE_NAMES.CITATION_GET_STATE,
  MESSAGE_NAMES.SIDEPANEL_STATE_CHANGED,
  MESSAGE_NAMES.CITATION_STATE_CHANGED,
  MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR,
  MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD,
]);

function validatePayloadShape(type, payload) {
  if (NO_PAYLOAD_TYPES.has(type)) {
    if (payload != null) {
      return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Message ${type} does not accept a payload.`);
    }
    return null;
  }
  if (payload == null) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Message ${type} requires a payload.`);
  }
  if (!isPlainObject(payload)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Message ${type} payload must be an object.`);
  }
  return null;
}

function normalizeRequest(message) {
  const validation = validateInternalMessageRequest(message, { allowedTypes: Object.values(MESSAGE_NAMES) });
  if (validation) {
    return validation;
  }
  return message;
}

export function createBackgroundRouter(deps = {}) {
  const authHandler = deps.authHandler;
  const bootstrapHandler = deps.bootstrapHandler;
  const captureHandler = deps.captureHandler;
  const citationHandler = deps.citationHandler;
  const editorHandler = deps.editorHandler;
  const surfaceHandler = deps.surfaceHandler;

  return async function dispatch(message, sender = {}) {
    const request = normalizeRequest(message);
    if (request && request.ok === false) {
      return request;
    }
    const shapeError = validatePayloadShape(request.type, request.payload);
    if (shapeError) {
      return shapeError;
    }

    switch (request.type) {
      case MESSAGE_NAMES.AUTH_GET_STATE:
        return authHandler.getState();
      case MESSAGE_NAMES.AUTH_RESTORE_SESSION:
        return authHandler.restoreSession();
      case MESSAGE_NAMES.AUTH_SIGN_OUT:
        return authHandler.signOut();
      case MESSAGE_NAMES.AUTH_ISSUE_HANDOFF:
        return authHandler.issueHandoff(request.payload || {});
      case MESSAGE_NAMES.AUTH_EXCHANGE_HANDOFF:
        return authHandler.exchangeHandoff(request.payload || {});
      case MESSAGE_NAMES.AUTH_CREATE_ATTEMPT:
        return authHandler.createAuthAttempt(request.payload || {});
      case MESSAGE_NAMES.AUTH_GET_ATTEMPT_STATUS:
        return authHandler.getAuthAttemptStatus(request.payload || {});
      case MESSAGE_NAMES.AUTH_COMPLETE_ATTEMPT:
        return authHandler.completeAuthAttempt(request.payload || {});
      case MESSAGE_NAMES.BOOTSTRAP_LOAD:
        return bootstrapHandler.loadBootstrap(request.payload || {});
      case MESSAGE_NAMES.BOOTSTRAP_GET_STATE:
        return bootstrapHandler.getState();
      case MESSAGE_NAMES.CAPTURE_CREATE_CITATION:
        return captureHandler.createCitation(request.payload || {}, sender);
      case MESSAGE_NAMES.CAPTURE_CREATE_QUOTE:
        return captureHandler.createQuote(request.payload || {}, sender);
      case MESSAGE_NAMES.CAPTURE_CREATE_NOTE:
        return captureHandler.createNote(request.payload || {}, sender);
      case MESSAGE_NAMES.CITATION_GET_STATE:
        return citationHandler.getState();
      case MESSAGE_NAMES.CITATION_RENDER:
        return citationHandler.renderCitation(request.payload || {});
      case MESSAGE_NAMES.CITATION_SAVE_STATE:
        return citationHandler.saveState(request.payload || {});
      case MESSAGE_NAMES.CITATION_STATE_CHANGED:
        return citationHandler.getState();
      case MESSAGE_NAMES.WORK_IN_EDITOR:
        if (!editorHandler?.workInEditor) {
          return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "Editor handler is unavailable.");
        }
        return editorHandler.workInEditor(request.payload || {}, sender);
      case MESSAGE_NAMES.SIDEPANEL_STATE_CHANGED:
        return authHandler.getState();
      case MESSAGE_NAMES.SIDEPANEL_LIST_CITATIONS:
        return surfaceHandler.listCitations(request.payload || {});
      case MESSAGE_NAMES.SIDEPANEL_LIST_NOTES:
        return surfaceHandler.listNotes(request.payload || {});
      case MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR:
        return surfaceHandler.openEditor(request.payload || {});
      case MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD:
        return surfaceHandler.openDashboard(request.payload || {});
      default:
        return createErrorResult(ERROR_CODES.UNSUPPORTED_MESSAGE, `Unsupported message: ${request.type}`);
    }
  };
}

export function createRouter(deps = {}) {
  return createBackgroundRouter(deps);
}
