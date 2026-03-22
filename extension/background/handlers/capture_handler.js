import { buildCitationCaptureRequest, buildNoteCaptureRequest, buildQuoteCaptureRequest, normalizeCaptureContext, } from "../../shared/types/capture.js";
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
function normalizeResult(result, requestId) {
    if (!result || typeof result !== "object") {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Capture result is invalid.", requestId);
    }
    if (result.ok === false) {
        return createErrorResult(result.error?.code || ERROR_CODES.INVALID_PAYLOAD, result.error?.message || "Capture failed.", requestId, result.error?.details, result.meta);
    }
    return createOkResult(result.data ?? null, requestId, result.meta);
}
function getCitationId(result) {
    return typeof result?.data?.id === "string" && result.data.id.trim()
        ? result.data.id.trim()
        : "";
}
function isErrorResult(result) {
    return Boolean(result) && typeof result === "object" && result.ok === false;
}
function readCapture(request) {
    const capture = normalizeCaptureContext(request?.payload?.capture || {});
    if (!capture.selectionText) {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.capture.selectionText must be a non-empty string.", request?.requestId);
    }
    if (!capture.pageTitle) {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.capture.pageTitle must be a non-empty string.", request?.requestId);
    }
    if (!capture.pageUrl) {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.capture.pageUrl must be a non-empty string.", request?.requestId);
    }
    return capture;
}
function readOptionalCapture(request) {
    const payload = request?.payload || {};
    if (payload.capture == null) {
        return null;
    }
    if (!payload.capture || typeof payload.capture !== "object") {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.capture must be an object when provided.", request?.requestId);
    }
    const capture = normalizeCaptureContext(payload.capture);
    if (!capture.selectionText && !payload.noteText) {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.noteText or payload.capture.selectionText must be a non-empty string.", request?.requestId);
    }
    if (payload.capture.pageTitle != null && !capture.pageTitle) {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.capture.pageTitle must be a non-empty string when provided.", request?.requestId);
    }
    if (payload.capture.pageUrl != null && !capture.pageUrl) {
        return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.capture.pageUrl must be a non-empty string when provided.", request?.requestId);
    }
    return capture;
}
export function createCaptureHandler({ captureApi } = {}) {
    if (!captureApi) {
        throw new Error("createCaptureHandler requires a captureApi.");
    }
    async function createCitationForContext(capture) {
        return captureApi.createCitation(buildCitationCaptureRequest(capture));
    }
    return {
        async createCitation(request) {
            const capture = readCapture(request);
            if (isErrorResult(capture)) {
                return capture;
            }
            const result = await createCitationForContext(capture);
            return normalizeResult(result, request.requestId);
        },
        async createQuote(request) {
            const capture = readCapture(request);
            if (isErrorResult(capture)) {
                return capture;
            }
            const citationResult = await createCitationForContext(capture);
            if (citationResult?.ok === false) {
                return normalizeResult(citationResult, request.requestId);
            }
            const citationId = getCitationId(citationResult);
            if (!citationId) {
                return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation capture response is missing an id.", request.requestId);
            }
            const result = await captureApi.createQuote(buildQuoteCaptureRequest({
                citationId,
                selectionText: capture.selectionText,
            }));
            return normalizeResult(result, request.requestId);
        },
        async createNote(request) {
            const capture = readOptionalCapture(request);
            if (isErrorResult(capture)) {
                return capture;
            }
            const result = await captureApi.createNote(buildNoteCaptureRequest({
                selectionText: capture?.selectionText,
                noteText: request?.payload?.noteText,
                pageTitle: capture?.pageTitle,
                pageUrl: capture?.pageUrl,
                pageDomain: capture?.pageDomain,
            }));
            return normalizeResult(result, request.requestId);
        },
    };
}
