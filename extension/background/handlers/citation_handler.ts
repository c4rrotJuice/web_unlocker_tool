import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.ts";
import { normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.ts";
import { buildCitationCaptureRequest, normalizeCaptureContext } from "../../shared/types/capture.ts";

function summarizeCapture(capture: any = {}) {
  return {
    pageUrl: capture.pageUrl || null,
    canonicalUrl: capture.canonicalUrl || null,
    selectionLength: String(capture.selectionText || "").trim().length,
    locatorKeys: Object.keys(capture.locator || {}).sort(),
    authorCandidateCount: Array.isArray(capture.authorCandidates) ? capture.authorCandidates.length : 0,
    dateCandidateCount: Array.isArray(capture.dateCandidates) ? capture.dateCandidates.length : 0,
    identifierKeys: Object.keys(capture.identifiers || {}).sort(),
  };
}

function mapError(result: any, requestId: string | undefined) {
  if (!result || typeof result !== "object" || result.ok !== false) {
    return null;
  }
  return createErrorResult(
    result.error?.code || ERROR_CODES.INVALID_PAYLOAD,
    result.error?.message || "Citation request failed.",
    requestId,
    result.error?.details ?? null,
    result.meta,
  );
}

export function createCitationHandler({
  citationApi,
  citationStateStore,
}: any = {}) {
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
      console.info("extension.citation.preview.start", {
        requestId: request?.requestId || null,
        style,
        ...summarizeCapture(capture),
      });
      const transportPayload = {
        ...capture,
        excerpt: request?.payload?.excerpt,
        locator: request?.payload?.locator ?? capture.locator,
        annotation: request?.payload?.annotation,
        quote: request?.payload?.quote,
      };
      const result = await citationApi.previewCitation({
        ...buildCitationCaptureRequest(transportPayload),
        style,
      });
      const mapped = mapError(result, request?.requestId);
      if (mapped) {
        console.warn("extension.citation.preview.failed", {
          requestId: request?.requestId || null,
          style,
          errorCode: mapped.error?.code || null,
        });
        return mapped;
      }
      console.info("extension.citation.preview.success", {
        requestId: request?.requestId || null,
        style,
        citationId: result?.data?.citation?.id || null,
      });
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
      console.info("extension.citation.save.start", {
        requestId: request?.requestId || null,
        style,
        format,
        ...summarizeCapture(capture),
      });
      const transportPayload = {
        ...capture,
        excerpt: request?.payload?.excerpt,
        locator: request?.payload?.locator ?? capture.locator,
        annotation: request?.payload?.annotation,
        quote: request?.payload?.quote,
      };
      const result = await citationApi.saveCitation({
        ...buildCitationCaptureRequest(transportPayload),
        style,
      });
      const mapped = mapError(result, request?.requestId);
      if (mapped) {
        console.warn("extension.citation.save.failed", {
          requestId: request?.requestId || null,
          style,
          format,
          errorCode: mapped.error?.code || null,
        });
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
      console.info("extension.citation.save.success", {
        requestId: request?.requestId || null,
        citationId,
        style,
        format,
      });
      return createOkResult({
        ...result.data,
        selected_style: nextState.selectedStyle,
        selected_format: nextState.selectedFormat,
      }, request?.requestId, result.meta);
    },
  };
}
