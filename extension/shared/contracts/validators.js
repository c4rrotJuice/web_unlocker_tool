import { MESSAGE_NAMES } from "../constants/message_names.js";
import { SURFACE_NAMES } from "../types/contracts.js";
import { normalizeCaptureContext } from "../types/capture.js";
import { ERROR_CODES, RESULT_STATUS, createErrorResult } from "../types/messages.js";
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
    return validateSurface(payload);
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
    if (!isNonEmptyString(payload.sourceId)) {
        return "payload.sourceId must be a non-empty string.";
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
    [MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: (payload) => validateCaptureEntityPayload(payload, "selectionText"),
    [MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: (payload) => validateCaptureEntityPayload(payload, "selectionText"),
    [MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: validateCaptureNotePayload,
    [MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: validateEditorPayload,
});
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
        return createErrorResult(ERROR_CODES.UNSUPPORTED_MESSAGE, `Unsupported message: ${message.type}`, message?.requestId);
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
        return createErrorResult(typeof error.code === "string" ? error.code : fallbackCode, typeof error.message === "string" && error.message.trim() ? error.message : `${label} failed.`, undefined, error.details ?? null, payload.meta ?? null);
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
