import { ERROR_CODES } from "./messages.js";

export const ERROR_KINDS = Object.freeze({
  AUTH: "auth",
  API: "api",
  VALIDATION: "validation",
  NETWORK: "network",
  CONTRACT: "contract",
});

function normalizeKind(kind, fallback = ERROR_KINDS.API) {
  return Object.values(ERROR_KINDS).includes(kind) ? kind : fallback;
}

export function createTypedErrorResult(kind, code, message, details = null, meta = null) {
  return {
    ok: false,
    status: "error",
    error: {
      kind: normalizeKind(kind),
      code,
      message,
      details,
    },
    meta,
  };
}

export function createAuthError(code, message, details = null, meta = null) {
  return createTypedErrorResult(ERROR_KINDS.AUTH, code, message, details, meta);
}

export function createApiError(code, message, details = null, meta = null) {
  return createTypedErrorResult(ERROR_KINDS.API, code, message, details, meta);
}

export function createValidationError(code = ERROR_CODES.INVALID_PAYLOAD, message = "Invalid payload.", details = null, meta = null) {
  return createTypedErrorResult(ERROR_KINDS.VALIDATION, code, message, details, meta);
}

export function createNetworkError(code = ERROR_CODES.NETWORK_ERROR, message = "Network request failed.", details = null, meta = null) {
  return createTypedErrorResult(ERROR_KINDS.NETWORK, code, message, details, meta);
}

export function createContractError(code = ERROR_CODES.INVALID_PAYLOAD, message = "Contract validation failed.", details = null, meta = null) {
  return createTypedErrorResult(ERROR_KINDS.CONTRACT, code, message, details, meta);
}

export function normalizeErrorModel(error, fallbackKind = ERROR_KINDS.API, fallbackCode = ERROR_CODES.INVALID_PAYLOAD, fallbackMessage = "Request failed.") {
  if (!error) {
    return {
      kind: normalizeKind(fallbackKind),
      code: fallbackCode,
      message: fallbackMessage,
      details: null,
    };
  }
  if (typeof error === "string") {
    return {
      kind: normalizeKind(fallbackKind),
      code: fallbackCode,
      message: error,
      details: null,
    };
  }
  return {
    kind: normalizeKind(error.kind, fallbackKind),
    code: typeof error.code === "string" ? error.code : fallbackCode,
    message: typeof error.message === "string" && error.message ? error.message : fallbackMessage,
    details: error.details ?? error.body ?? null,
  };
}
