import { MESSAGE_NAMES } from "../../shared/constants/message_names.ts";
import { validateMessageEnvelope } from "../../shared/contracts/validators.ts";
import { createErrorResult, createNotImplementedResult, ERROR_CODES } from "../../shared/types/messages.ts";

const KNOWN_TYPES = Object.values(MESSAGE_NAMES);

function createDefaultHandlers() {
  return {
    auth: {
      start: (request) => createNotImplementedResult(request.type, request.requestId),
      getStatus: (request) => createNotImplementedResult(request.type, request.requestId),
      logout: (request) => createNotImplementedResult(request.type, request.requestId),
    },
    bootstrap: {
      fetch: (request) => createNotImplementedResult(request.type, request.requestId),
    },
    sidepanel: {
      listRecentCitations: (request) => createNotImplementedResult(request.type, request.requestId),
      listRecentNotes: (request) => createNotImplementedResult(request.type, request.requestId),
      openEditor: (request) => createNotImplementedResult(request.type, request.requestId),
      openDashboard: (request) => createNotImplementedResult(request.type, request.requestId),
    },
    capture: {
      createCitation: (request) => createNotImplementedResult(request.type, request.requestId),
      createQuote: (request) => createNotImplementedResult(request.type, request.requestId),
      createNote: (request) => createNotImplementedResult(request.type, request.requestId),
    },
    citation: {
      render: (request) => createNotImplementedResult(request.type, request.requestId),
      save: (request) => createNotImplementedResult(request.type, request.requestId),
    },
    editor: {
      requestWorkInEditor: (request) => createNotImplementedResult(request.type, request.requestId),
    },
    ui: {
      ping: (request) => createNotImplementedResult(request.type, request.requestId),
      openSidepanel: (request) => createNotImplementedResult(request.type, request.requestId),
    },
  };
}

function createRouteTable(handlers) {
  return {
    [MESSAGE_NAMES.PING]: handlers.ui.ping,
    [MESSAGE_NAMES.OPEN_SIDEPANEL]: handlers.ui.openSidepanel,
    [MESSAGE_NAMES.AUTH_START]: handlers.auth.start,
    [MESSAGE_NAMES.AUTH_STATUS_GET]: handlers.auth.getStatus,
    [MESSAGE_NAMES.AUTH_LOGOUT]: handlers.auth.logout,
    [MESSAGE_NAMES.BOOTSTRAP_FETCH]: handlers.bootstrap.fetch,
    [MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_CITATIONS]: handlers.sidepanel.listRecentCitations,
    [MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_NOTES]: handlers.sidepanel.listRecentNotes,
    [MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR]: handlers.sidepanel.openEditor,
    [MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD]: handlers.sidepanel.openDashboard,
    [MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: handlers.capture.createCitation,
    [MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: handlers.capture.createQuote,
    [MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: handlers.capture.createNote,
    [MESSAGE_NAMES.CITATION_RENDER]: handlers.citation.render,
    [MESSAGE_NAMES.CITATION_SAVE]: handlers.citation.save,
    [MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: handlers.editor.requestWorkInEditor,
  };
}

export function createBackgroundRouter(deps = {}) {
  const typedDeps = deps as { handlers?: any };
  const routeTable = createRouteTable(typedDeps.handlers || createDefaultHandlers());

  return async function routeMessage(message, sender = {}) {
    const envelopeError = validateMessageEnvelope(message, { allowedTypes: KNOWN_TYPES });
    if (envelopeError) {
      return envelopeError;
    }

    const handler = routeTable[message.type];
    if (typeof handler !== "function") {
      return createErrorResult(
        ERROR_CODES.UNSUPPORTED_MESSAGE,
        `Unsupported message: ${message.type}`,
        message.requestId,
      );
    }

    try {
      return await handler(message, sender);
    } catch (error) {
      return createErrorResult(
        ERROR_CODES.UNEXPECTED_ERROR,
        error?.message || `Handler failed for ${message.type}.`,
        message.requestId,
      );
    }
  };
}
