// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.js";
import { buildCitationCaptureRequest, normalizeCaptureContext } from "../../shared/types/capture.js";
function mapError(result, requestId) {
    if (!result || typeof result !== "object" || result.ok !== false) {
        return null;
    }
    return createErrorResult(result.error?.code || ERROR_CODES.INVALID_PAYLOAD, result.error?.message || "Citation request failed.", requestId, result.error?.details ?? null, result.meta);
}
export function createCitationHandler({ citationApi, citationStateStore, } = {}) {
    if (!citationApi) {
        throw new Error("createCitationHandler requires a citationApi.");
    }
    if (!citationStateStore) {
        throw new Error("createCitationHandler requires a citationStateStore.");
    }
    return {
        async preview(request) {
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
            const style = normalizeCitationStyle(request?.payload?.style || "apa");
            const result = await citationApi.previewCitation({
                ...buildCitationCaptureRequest(capture),
                style,
            });
            const mapped = mapError(result, request?.requestId);
            if (mapped) {
                return mapped;
            }
            return createOkResult(result.data, request?.requestId, result.meta);
        },
        async render(request) {
            const citationId = String(request?.payload?.citationId || "").trim();
            if (!citationId) {
                return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.citationId must be a non-empty string.", request?.requestId);
            }
            const style = normalizeCitationStyle(request?.payload?.style || "apa");
            const result = await citationApi.renderCitation({
                citation_id: citationId,
                style,
            });
            const mapped = mapError(result, request?.requestId);
            if (mapped) {
                return mapped;
            }
            return createOkResult(result.data, request?.requestId, result.meta);
        },
        async save(request) {
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
            const style = normalizeCitationStyle(request?.payload?.style || "apa");
            const format = normalizeCitationFormat(request?.payload?.format || "bibliography");
            const result = await citationApi.saveCitation({
                ...buildCitationCaptureRequest(capture),
                style,
            });
            const mapped = mapError(result, request?.requestId);
            if (mapped) {
                return mapped;
            }
            const citationId = String(result?.data?.id || "").trim();
            if (!citationId) {
                return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation save response is missing an id.", request?.requestId);
            }
            const nextState = await citationStateStore.saveSelection({
                citationId,
                style,
                format,
                copy: false,
            });
            return createOkResult({
                ...result.data,
                selected_style: nextState.selectedStyle,
                selected_format: nextState.selectedFormat,
            }, request?.requestId, result.meta);
        },
    };
}
