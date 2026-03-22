import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { normalizeCitationStyle } from "../../shared/types/citation.js";
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
            const citationId = String(request?.payload?.citationId || "").trim();
            if (!citationId) {
                return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "payload.citationId must be a non-empty string.", request?.requestId);
            }
            const nextState = citationStateStore.saveSelection({
                citationId,
                style: request?.payload?.style,
                format: request?.payload?.format,
                copy: request?.payload?.copy === true,
            });
            return createOkResult({
                saved: true,
                citationId,
                style: nextState.selectedStyle,
                format: nextState.selectedFormat,
                copy: nextState.copied,
                savedAt: nextState.savedAt,
            }, request?.requestId);
        },
    };
}
