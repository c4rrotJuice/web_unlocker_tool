export const RESULT_STATUS = Object.freeze({
    OK: "ok",
    ERROR: "error",
});
export const ERROR_CODES = Object.freeze({
    INVALID_PAYLOAD: "invalid_payload",
    INVALID_CONTEXT: "invalid_context",
    UNSUPPORTED_MESSAGE: "unsupported_message",
    NOT_IMPLEMENTED: "not_implemented",
    UNEXPECTED_ERROR: "unexpected_error",
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
export function createOkResult(data = null, requestId = undefined, meta = undefined) {
    return {
        ok: true,
        status: RESULT_STATUS.OK,
        requestId,
        data,
        meta,
    };
}
export function createErrorResult(code, message, requestId = undefined, details = undefined, meta = undefined) {
    return {
        ok: false,
        status: RESULT_STATUS.ERROR,
        requestId,
        error: {
            code,
            message,
            details,
        },
        meta,
    };
}
export function createNotImplementedResult(messageType, requestId = undefined, details = undefined) {
    return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, `${messageType} is not implemented in this phase.`, requestId, details);
}
export function isErrorResult(result) {
    return result.ok === false;
}
export function isOkResult(result) {
    return result.ok === true;
}
