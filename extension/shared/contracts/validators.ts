import { ERROR_CODES } from "../types/messages.ts";
import { createContractError, createValidationError } from "../types/error_model.ts";
import { CAPTURE_KIND } from "../types/capture.ts";
import { CITATION_FORMATS, CITATION_STYLES } from "../types/citation.ts";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function createShapeError(label, details = null) {
  return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${label} has an invalid shape.`, details);
}

function validateNullableObject(value, label, required = false) {
  if (value == null) {
    return required ? createShapeError(`${label} is required.`) : null;
  }
  if (!isPlainObject(value)) {
    return createShapeError(`${label} must be an object when present.`);
  }
  return null;
}

export function validateInternalMessageRequest(message, { allowedTypes = null } = {}) {
  if (!isPlainObject(message)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Invalid message envelope.");
  }
  if (!isString(message.type)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Message type is required.");
  }
  if (Array.isArray(allowedTypes) && allowedTypes.length && !allowedTypes.includes(message.type)) {
    return createContractError(ERROR_CODES.UNSUPPORTED_MESSAGE, `Unsupported message: ${message.type}`);
  }
  if (message.requestId != null && !isString(message.requestId)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "requestId must be a string when provided.");
  }
  return null;
}

export function validateInternalMessageResponse(response, label = "Internal message response") {
  if (!isPlainObject(response)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${label} is invalid.`);
  }
  if (typeof response.ok !== "boolean") {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${label} is missing an ok flag.`);
  }
  if (response.status !== "ok" && response.status !== "error") {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${label} is missing a status.`);
  }
  if (response.ok) {
    return null;
  }
  if (!isPlainObject(response.error)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${label} is missing an error payload.`);
  }
  if (!isString(response.error.code) || !isString(response.error.message)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${label} contains an invalid error payload.`);
  }
  return null;
}

export function validateResultEnvelope(payload, {
  label = "Backend response",
  dataValidator = null,
  fallbackCode = ERROR_CODES.INVALID_PAYLOAD,
} = {}) {
  if (!isPlainObject(payload)) {
    return createContractError(fallbackCode, `${label} must be a JSON object.`);
  }
  if (typeof payload.ok !== "boolean") {
    return createContractError(fallbackCode, `${label} is missing an ok flag.`);
  }
  if (payload.status != null && payload.status !== "ok" && payload.status !== "error") {
    return createContractError(fallbackCode, `${label} contains an invalid status flag.`);
  }
  if (payload.ok === false) {
    if (!isPlainObject(payload.error)) {
      return createContractError(fallbackCode, `${label} is missing an error payload.`);
    }
    const code = isString(payload.error.code) ? payload.error.code : fallbackCode;
    const message = isString(payload.error.message) ? payload.error.message : `${label} failed.`;
    return createValidationError(code, message, payload.error.details ?? null, payload.meta ?? null);
  }
  if (dataValidator) {
    const normalized = dataValidator(payload.data, payload);
    if (!normalized || normalized.ok === false) {
      return normalized || createContractError(fallbackCode, `${label} data failed validation.`);
    }
    return normalized;
  }
  return { ok: true, status: "ok", data: payload.data ?? null, meta: payload.meta ?? null };
}

export function validateBootstrapSnapshot(payload) {
  const source = isPlainObject(payload) ? payload : null;
  if (!source) {
    return createContractError(ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap payload must be a JSON object.");
  }
  const next = {};
  for (const key of ["profile", "entitlement", "capabilities", "app", "taxonomy"]) {
    const error = validateNullableObject(source[key], `Bootstrap field ${key}`);
    if (error) {
      return error;
    }
    next[key] = source[key] ?? null;
  }
  return { ok: true, status: "ok", data: next, meta: null };
}

export function validateCitationRenderBundlePayload(payload) {
  if (!isPlainObject(payload)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle must be a JSON object.");
  }
  if (!isPlainObject(payload.renders)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle must include renders.");
  }
  const renders = {};
  let hasRenderableStyle = false;
  for (const [style, bundle] of Object.entries(payload.renders)) {
    if (!CITATION_STYLES.includes(style)) {
      return createContractError(ERROR_CODES.INVALID_PAYLOAD, `Unsupported citation style: ${style}.`);
    }
    if (!isPlainObject(bundle)) {
      return createContractError(ERROR_CODES.INVALID_PAYLOAD, `Citation render bundle for ${style} must be an object.`);
    }
    const nextBundle = {};
    for (const format of CITATION_FORMATS) {
      if (bundle[format] == null) {
        continue;
      }
      if (typeof bundle[format] !== "string") {
        return createContractError(ERROR_CODES.INVALID_PAYLOAD, `Citation render bundle for ${style}.${format} must be a string.`);
      }
      nextBundle[format] = bundle[format];
    }
    if (Object.keys(nextBundle).length) {
      hasRenderableStyle = true;
    }
    renders[style] = nextBundle;
  }
  if (!hasRenderableStyle) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle did not include any render text.");
  }
  return { ok: true, status: "ok", data: { ...payload, renders }, meta: payload.meta ?? null };
}

export function validateCaptureEntityResponse(payload, kind = CAPTURE_KIND.CITATION) {
  if (!isPlainObject(payload)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Capture response must be a JSON object.");
  }
  const hasDirectId = isString(payload.id);
  const hasNestedCitation = isPlainObject(payload.citation) && isString(payload.citation.id);
  const hasNestedQuote = isPlainObject(payload.quote) && isString(payload.quote.id);
  const hasNestedNote = isPlainObject(payload.note) && isString(payload.note.id);
  if (kind === CAPTURE_KIND.CITATION && !hasDirectId && !hasNestedCitation) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Citation capture response requires an id.");
  }
  if (kind === CAPTURE_KIND.QUOTE && !hasDirectId && !hasNestedQuote && !hasNestedCitation) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Quote capture response requires an id.");
  }
  if (kind === CAPTURE_KIND.NOTE && !hasDirectId && !hasNestedNote) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Note capture response requires an id.");
  }
  return { ok: true, status: "ok", data: payload, meta: payload.meta ?? null };
}

export function validateWorkInEditorResponseData(payload) {
  if (!isPlainObject(payload)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "Work-in-editor response must be a JSON object.");
  }
  if (!isString(payload.editor_url)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "editor_url is required in the work-in-editor response.");
  }
  if (!isString(payload.document_id)) {
    return createContractError(ERROR_CODES.INVALID_PAYLOAD, "document_id is required in the work-in-editor response.");
  }
  for (const key of ["redirect_path", "editor_path", "seed", "document", "citation", "quote", "note"]) {
    if (key in payload && payload[key] != null && (key === "seed" || key === "document" || key === "citation" || key === "quote" || key === "note")) {
      if (!isPlainObject(payload[key])) {
        return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${key} must be an object when present in the work-in-editor response.`);
      }
      continue;
    }
    if ((key === "redirect_path" || key === "editor_path") && payload[key] != null && typeof payload[key] !== "string") {
      return createContractError(ERROR_CODES.INVALID_PAYLOAD, `${key} must be a string when present in the work-in-editor response.`);
    }
  }
  return { ok: true, status: "ok", data: payload, meta: payload.meta ?? null };
}
