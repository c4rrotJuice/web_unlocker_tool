export const RESULT_STATUS = Object.freeze({
  OK: "ok",
  ERROR: "error",
});

export const ERROR_CODES = Object.freeze({
  UNSUPPORTED_MESSAGE: "unsupported_message",
  INVALID_PAYLOAD: "invalid_payload",
  NOT_IMPLEMENTED: "not_implemented",
  NETWORK_ERROR: "network_error",
  UNAUTHORIZED: "unauthorized",
  AUTH_INVALID: "auth_invalid",
  BOOTSTRAP_FAILED: "bootstrap_failed",
  HANDOFF_INVALID: "handoff_invalid",
  HANDOFF_EXPIRED: "handoff_expired",
  HANDOFF_ALREADY_USED: "handoff_already_used",
  HANDOFF_PAYLOAD_INVALID: "handoff_payload_invalid",
  HANDOFF_REFRESH_FAILED: "handoff_refresh_failed",
  AUTH_ATTEMPT_INVALID: "auth_attempt_invalid",
  AUTH_ATTEMPT_EXPIRED: "auth_attempt_expired",
});

export function createOkResult(data = undefined, meta = undefined) {
  return { ok: true, status: RESULT_STATUS.OK, data, meta };
}

export function createErrorResult(code, message, details = undefined, meta = undefined) {
  return {
    ok: false,
    status: RESULT_STATUS.ERROR,
    error: { code, message, details },
    meta,
  };
}

export function normalizeErrorCode(code) {
  if (!code || typeof code !== "string") {
    return ERROR_CODES.INVALID_PAYLOAD;
  }
  if (Object.values(ERROR_CODES).includes(code)) {
    return code;
  }
  return code;
}

/**
 * @typedef {Object} ExtensionError
 * @property {string} code
 * @property {string} message
 * @property {unknown} [details]
 *
 * @typedef {Object} ExtensionRequest
 * @property {string} type
 * @property {string} [requestId]
 * @property {unknown} [payload]
 *
 * @typedef {Object} ExtensionResponse
 * @property {boolean} ok
 * @property {string} status
 * @property {unknown} [data]
 * @property {ExtensionError} [error]
 * @property {unknown} [meta]
 *
 * @typedef {Object} ExtensionResult
 * @property {boolean} ok
 * @property {string} status
 * @property {unknown} [data]
 * @property {ExtensionError} [error]
 * @property {unknown} [meta]
 */
