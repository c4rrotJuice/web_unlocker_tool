import { normalizeCaptureIntent, CAPTURE_KIND } from "../../shared/types/capture.ts";
import { ERROR_CODES, createErrorResult } from "../../shared/types/messages.ts";
import { validateCaptureEntityResponse } from "../../shared/contracts/validators.ts";

function mapCaptureError(result) {
  if (!result || typeof result !== "object" || result.ok !== false) {
    return null;
  }
  const error = result.error || {};
  const code = typeof error.code === "string" ? error.code : ERROR_CODES.INVALID_PAYLOAD;
  const message = typeof error.message === "string" && error.message ? error.message : "Capture failed.";
  return createErrorResult(code, message, error.details ?? null, result.meta ?? null);
}

export function createCaptureHandler({ captureApi, stateStore, citationStateStore, notifyCitationChange, notifySidepanelChange, chromeApi } = {}) {
  if (!captureApi) {
    throw new Error("createCaptureHandler requires a captureApi.");
  }
  if (!stateStore) {
    throw new Error("createCaptureHandler requires a stateStore.");
  }

  async function dispatch(kind, payload, sender = {}) {
    const normalized = normalizeCaptureIntent(payload, kind);
    if (!normalized.ok) {
      stateStore.setError(normalized.error, "capture_invalid");
      return normalized;
    }
    const intent = normalized.data;
    const apiPayload = {
      selectionText: intent.selectionText,
      pageTitle: intent.pageTitle,
      pageUrl: intent.pageUrl,
      pageDomain: intent.pageDomain,
      metadata: intent.metadata,
      noteText: intent.noteText,
      action: intent.action,
    };
    const result = kind === CAPTURE_KIND.CITATION
      ? await captureApi.createCitation(apiPayload)
      : kind === CAPTURE_KIND.QUOTE
        ? await captureApi.createQuote(apiPayload)
        : await captureApi.createNote(apiPayload);
    const error = mapCaptureError(result);
    if (error) {
      stateStore.setError(error.error || error, "capture_failed");
      return error;
    }
    const validated = validateCaptureEntityResponse(result.data, kind);
    if (!validated.ok) {
      stateStore.setError(validated.error, "capture_invalid");
      return validated;
    }
    notifySidepanelChange?.();
    if (kind === CAPTURE_KIND.CITATION && citationStateStore?.openFromCitation) {
      const opened = citationStateStore.openFromCitation(result.data);
      if (!opened.ok && opened.error) {
        citationStateStore.setError(opened.error, "citation_open_failed");
      } else {
        notifyCitationChange?.(citationStateStore.getState());
        const windowId = sender?.tab?.windowId;
        if (windowId != null && chromeApi?.sidePanel?.open) {
          try {
            void chromeApi.sidePanel.open({ windowId });
          } catch {
            // best effort only
          }
        }
      }
    }
    return result;
  }

  return {
    createCitation(payload, sender) {
      return dispatch(CAPTURE_KIND.CITATION, payload, sender);
    },
    createQuote(payload, sender) {
      return dispatch(CAPTURE_KIND.QUOTE, payload, sender);
    },
    createNote(payload, sender) {
      return dispatch(CAPTURE_KIND.NOTE, payload, sender);
    },
  };
}
