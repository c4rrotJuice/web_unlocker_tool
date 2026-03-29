import { MESSAGE_NAMES } from "../constants/message_names.ts";
import { SURFACE_NAMES } from "../types/contracts.ts";
import { CITATION_FORMATS, CITATION_STYLES, normalizeCitationFormat, normalizeCitationStyle } from "../types/citation.ts";
import { normalizeCaptureContext } from "../types/capture.ts";
import { ERROR_CODES, RESULT_STATUS, createErrorResult } from "../types/messages.ts";

const KNOWN_MESSAGE_TYPES = new Set(Object.values(MESSAGE_NAMES));
const KNOWN_SURFACES = new Set(Object.values(SURFACE_NAMES));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSurface(payload) {
  if (!isPlainObject(payload) || !isNonEmptyString(payload.surface) || !KNOWN_SURFACES.has(payload.surface)) {
    return "payload.surface must be one of the canonical extension surfaces.";
  }
  return null;
}

function validatePingPayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (payload.href != null && !isNonEmptyString(payload.href)) {
    return "payload.href must be a non-empty string when provided.";
  }
  return null;
}

function validateOpenSidepanelPayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (payload.mode != null && payload.mode !== "open" && payload.mode !== "toggle") {
    return "payload.mode must be open or toggle when provided.";
  }
  return null;
}

function validateAuthStartPayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (!isNonEmptyString(payload.trigger)) {
    return "payload.trigger must be a non-empty string.";
  }
  if (payload.redirectPath != null && !isNonEmptyString(payload.redirectPath)) {
    return "payload.redirectPath must be a non-empty string when provided.";
  }
  return null;
}

function validateStatusPayload(payload) {
  return validateSurface(payload);
}

function validateListPayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (payload.limit != null && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 50)) {
    return "payload.limit must be an integer between 1 and 50 when provided.";
  }
  if (payload.offset != null && (!Number.isInteger(payload.offset) || payload.offset < 0)) {
    return "payload.offset must be a non-negative integer when provided.";
  }
  if (payload.query != null && !isNonEmptyString(payload.query)) {
    return "payload.query must be a non-empty string when provided.";
  }
  return null;
}

function validateSidepanelUpdateNotePayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (!isNonEmptyString(payload.noteId)) {
    return "payload.noteId must be a non-empty string.";
  }
  if (!isNonEmptyString(payload.title)) {
    return "payload.title must be a non-empty string.";
  }
  if (!isNonEmptyString(payload.note_body)) {
    return "payload.note_body must be a non-empty string.";
  }
  return null;
}

function validateCaptureEntityPayload(payload, contentField) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (!isPlainObject(payload.capture)) {
    return "payload.capture must be an object.";
  }
  const capture = normalizeCaptureContext(payload.capture);
  if (!isNonEmptyString(capture[contentField])) {
    return `payload.capture.${contentField} must be a non-empty string.`;
  }
  if (!isNonEmptyString(capture.pageTitle)) {
    return "payload.capture.pageTitle must be a non-empty string.";
  }
  if (!isNonEmptyString(capture.pageUrl)) {
    return "payload.capture.pageUrl must be a non-empty string.";
  }
  return null;
}

function validateCaptureNotePayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (payload.noteText != null && !isNonEmptyString(payload.noteText)) {
    return "payload.noteText must be a non-empty string when provided.";
  }
  if (payload.capture != null && !isPlainObject(payload.capture)) {
    return "payload.capture must be an object when provided.";
  }
  const capture = payload.capture ? normalizeCaptureContext(payload.capture) : null;
  const hasSelection = isNonEmptyString(capture?.selectionText);
  const hasNoteText = isNonEmptyString(payload.noteText);
  if (!hasSelection && !hasNoteText) {
    return "payload.noteText or payload.capture.selectionText must be a non-empty string.";
  }
  if (capture) {
    if (payload.capture.pageTitle != null && !isNonEmptyString(capture.pageTitle)) {
      return "payload.capture.pageTitle must be a non-empty string when provided.";
    }
    if (payload.capture.pageUrl != null && !isNonEmptyString(capture.pageUrl)) {
      return "payload.capture.pageUrl must be a non-empty string when provided.";
    }
  }
  return null;
}

function validateEditorPayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (!isNonEmptyString(payload.url)) {
    return "payload.url must be a non-empty string.";
  }
  return null;
}

function validateCitationRenderPayload(payload) {
  const surfaceError = validateSurface(payload);
  if (surfaceError) {
    return surfaceError;
  }
  if (!isNonEmptyString(payload.citationId)) {
    return "payload.citationId must be a non-empty string.";
  }
  if (!isNonEmptyString(payload.style)) {
    return "payload.style must be a non-empty string.";
  }
  if (normalizeCitationStyle(payload.style, "") !== payload.style.trim().toLowerCase()) {
    return "payload.style must be one of the supported citation styles.";
  }
  return null;
}

function validateCitationPreviewPayload(payload) {
  const captureError = validateCaptureEntityPayload(payload, "selectionText");
  if (captureError) {
    return captureError;
  }
  if (!isNonEmptyString(payload.style)) {
    return "payload.style must be a non-empty string.";
  }
  if (normalizeCitationStyle(payload.style, "") !== payload.style.trim().toLowerCase()) {
    return "payload.style must be one of the supported citation styles.";
  }
  return null;
}

function validateCitationSavePayload(payload) {
  const previewError = validateCitationPreviewPayload(payload);
  if (previewError) {
    return previewError;
  }
  if (!isNonEmptyString(payload.format)) {
    return "payload.format must be a non-empty string.";
  }
  if (normalizeCitationFormat(payload.format, "") !== payload.format.trim().toLowerCase()) {
    return "payload.format must be one of the supported citation formats.";
  }
  return null;
}

export const REQUEST_PAYLOAD_VALIDATORS = Object.freeze({
  [MESSAGE_NAMES.PING]: validatePingPayload,
  [MESSAGE_NAMES.OPEN_SIDEPANEL]: validateOpenSidepanelPayload,
  [MESSAGE_NAMES.AUTH_START]: validateAuthStartPayload,
  [MESSAGE_NAMES.AUTH_STATUS_GET]: validateStatusPayload,
  [MESSAGE_NAMES.AUTH_LOGOUT]: validateStatusPayload,
  [MESSAGE_NAMES.BOOTSTRAP_FETCH]: validateStatusPayload,
  [MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_CITATIONS]: validateListPayload,
  [MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_NOTES]: validateListPayload,
  [MESSAGE_NAMES.SIDEPANEL_UPDATE_NOTE]: validateSidepanelUpdateNotePayload,
  [MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR]: validateStatusPayload,
  [MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD]: validateStatusPayload,
  [MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: (payload) => validateCaptureEntityPayload(payload, "selectionText"),
  [MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: (payload) => validateCaptureEntityPayload(payload, "selectionText"),
  [MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: validateCaptureNotePayload,
  [MESSAGE_NAMES.CITATION_PREVIEW]: validateCitationPreviewPayload,
  [MESSAGE_NAMES.CITATION_RENDER]: validateCitationRenderPayload,
  [MESSAGE_NAMES.CITATION_SAVE]: validateCitationSavePayload,
  [MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: validateEditorPayload,
});

export function validateCitationRenderBundle(payload) {
  if (!isPlainObject(payload)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle must be a JSON object.");
  }
  if (!isPlainObject(payload.renders)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle must include renders.");
  }
  const renders = {};
  let hasRenderableText = false;
  for (const [style, bundle] of Object.entries(payload.renders)) {
    if (!CITATION_STYLES.includes(style)) {
      return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Unsupported citation style: ${style}.`);
    }
    if (!isPlainObject(bundle)) {
      return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Citation render bundle for ${style} must be an object.`);
    }
    renders[style] = {};
    for (const format of CITATION_FORMATS) {
      if (bundle[format] == null) {
        continue;
      }
      if (typeof bundle[format] !== "string") {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, `Citation render bundle for ${style}.${format} must be a string.`);
      }
      renders[style][format] = bundle[format];
      if (bundle[format].trim()) {
        hasRenderableText = true;
      }
    }
  }
  if (!hasRenderableText) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle did not include any render text.");
  }
  return {
    ok: true,
    status: RESULT_STATUS.OK,
    data: {
      ...payload,
      renders,
      cache_hit: Boolean(payload.cache_hit),
    },
    meta: payload.meta ?? null,
  };
}

export function validateCitationPreviewResponse(payload) {
  if (!isPlainObject(payload)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation preview must be a JSON object.");
  }
  if (!isPlainObject(payload.citation)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation preview must include citation data.");
  }
  const renderBundleResult = validateCitationRenderBundle(payload.render_bundle);
  if (renderBundleResult?.ok === false) {
    return renderBundleResult;
  }
  const normalizedRenderBundle = renderBundleResult && "data" in renderBundleResult
    ? renderBundleResult.data
    : payload.render_bundle;
  return {
    ok: true,
    status: RESULT_STATUS.OK,
    data: {
      ...payload,
      render_bundle: normalizedRenderBundle,
    },
    meta: payload.meta ?? null,
  };
}

export function validateMessageEnvelope(message, { allowedTypes = null } = {}) {
  if (!isPlainObject(message)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Invalid message envelope.");
  }

  if (!isNonEmptyString(message.type)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Message type is required.", message?.requestId);
  }

  if (message.requestId != null && !isNonEmptyString(message.requestId)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "requestId must be a non-empty string when provided.");
  }

  if (!("payload" in message) || !isPlainObject(message.payload)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload must be an object.", message?.requestId);
  }

  const typeAllowed = Array.isArray(allowedTypes) && allowedTypes.length
    ? allowedTypes.includes(message.type)
    : KNOWN_MESSAGE_TYPES.has(message.type);

  if (!typeAllowed) {
    return createErrorResult(
      ERROR_CODES.UNSUPPORTED_MESSAGE,
      `Unsupported message: ${message.type}`,
      message?.requestId,
    );
  }

  const payloadValidator = REQUEST_PAYLOAD_VALIDATORS[message.type];
  if (typeof payloadValidator !== "function") {
    return createErrorResult(ERROR_CODES.UNSUPPORTED_MESSAGE, `Unsupported message: ${message.type}`, message?.requestId);
  }

  const payloadError = payloadValidator(message.payload);
  if (payloadError) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, payloadError, message.requestId);
  }

  return null;
}

export function validateMessageResult(result, requestId = undefined) {
  if (!isPlainObject(result)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Runtime result must be an object.", requestId);
  }
  if (result.ok !== true && result.ok !== false) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Runtime result must include a boolean ok flag.", requestId);
  }
  if (result.status !== RESULT_STATUS.OK && result.status !== RESULT_STATUS.ERROR) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Runtime result must include a canonical status.", requestId);
  }
  if (result.requestId != null && !isNonEmptyString(result.requestId)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Runtime result requestId must be a non-empty string when provided.", requestId);
  }
  if (result.ok === true) {
    return null;
  }
  if (!isPlainObject(result.error) || !isNonEmptyString(result.error.code) || !isNonEmptyString(result.error.message)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Runtime error result must include a structured error payload.", requestId);
  }
  return null;
}

export function validateResultEnvelope(payload, { fallbackCode = ERROR_CODES.NETWORK_ERROR, label = "Backend response" } = {}) {
  if (!isPlainObject(payload)) {
    return createErrorResult(fallbackCode, `${label} must be a JSON object.`);
  }
  if (payload.ok !== true && payload.ok !== false) {
    return createErrorResult(fallbackCode, `${label} must include an ok flag.`);
  }
  if (payload.ok === false) {
    const error = payload.error || {};
    return createErrorResult(
      typeof error.code === "string" ? error.code : fallbackCode,
      typeof error.message === "string" && error.message.trim() ? error.message : `${label} failed.`,
      undefined,
      error.details ?? null,
      payload.meta ?? null,
    );
  }
  return {
    ok: true,
    status: RESULT_STATUS.OK,
    data: payload.data ?? null,
    meta: payload.meta ?? null,
  };
}

export function validateBootstrapSnapshot(payload) {
  if (!isPlainObject(payload)) {
    return createErrorResult(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap payload must be an object.");
  }
  if (!isPlainObject(payload.profile)) {
    return createErrorResult(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap profile is required.");
  }
  if (!isPlainObject(payload.entitlement)) {
    return createErrorResult(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap entitlement is required.");
  }
  if (!isPlainObject(payload.capabilities)) {
    return createErrorResult(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap capabilities are required.");
  }
  if (!isPlainObject(payload.app)) {
    return createErrorResult(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap app config is required.");
  }
  if (!isPlainObject(payload.taxonomy)) {
    return createErrorResult(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap taxonomy is required.");
  }
  return {
    ok: true,
    status: RESULT_STATUS.OK,
    data: payload,
    meta: null,
  };
}

export function validateWorkInEditorLaunchResponse(payload) {
  if (!isPlainObject(payload)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Work-in-editor response must be an object.");
  }
  if (!isNonEmptyString(payload.editor_url)) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Work-in-editor response must include editor_url.");
  }
  return {
    ok: true,
    status: RESULT_STATUS.OK,
    data: payload,
    meta: null,
  };
}
