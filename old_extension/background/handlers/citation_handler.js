import { ERROR_CODES, createErrorResult, createOkResult } from "../../shared/types/messages.js";
import { normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.js";
import { validateCitationRenderBundlePayload } from "../../shared/contracts/validators.js";

function mapError(result) {
  if (!result || typeof result !== "object" || result.ok !== false) {
    return null;
  }
  const error = result.error || {};
  const code = typeof error.code === "string" ? error.code : ERROR_CODES.INVALID_PAYLOAD;
  const message = typeof error.message === "string" && error.message ? error.message : "Citation request failed.";
  return createErrorResult(code, message, error.details ?? null, result.meta ?? null);
}

export function createCitationHandler({ citationApi, citationStateStore, notifyCitationChange } = {}) {
  if (!citationApi) {
    throw new Error("createCitationHandler requires a citationApi.");
  }
  if (!citationStateStore) {
    throw new Error("createCitationHandler requires a citationStateStore.");
  }

  async function renderCitation(payload = {}) {
    const citation_id = String(payload.citation_id || payload.citationId || "").trim();
    if (!citation_id) {
      const error = createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "citation_id is required.", null, null);
      citationStateStore.setError(error.error, "citation_render_invalid");
      return error;
    }
    const style = normalizeCitationStyle(payload.style || citationStateStore.getState().selected_style || "apa");
    citationStateStore.setLoading("rendering_citation");
    const result = await citationApi.renderCitation({ citation_id, style });
    const error = mapError(result);
    if (error) {
      citationStateStore.setError(error.error, "citation_render_failed");
      return error;
    }
    const validatedBundle = validateCitationRenderBundlePayload(result.data || {});
    if (!validatedBundle.ok) {
      citationStateStore.setError(validatedBundle.error, "citation_render_invalid");
      return validatedBundle;
    }
    const bundle = validatedBundle.data;
    citationStateStore.setRenderBundle(bundle, { style, citation: citationStateStore.getState().citation, format: payload.format });
    notifyCitationChange?.(citationStateStore.getState());
    return createOkResult({
      citation_id,
      style,
      renders: bundle.renders,
      cache_hit: bundle.cache_hit,
    }, result.meta ?? null);
  }

  function getState() {
    return createOkResult({ citation: citationStateStore.getState() });
  }

  function saveState(payload = {}) {
    const style = normalizeCitationStyle(payload.style || citationStateStore.getState().selected_style || "apa");
    const format = normalizeCitationFormat(payload.format || citationStateStore.getState().selected_format || "bibliography");
    citationStateStore.setSelection({ style, format });
    citationStateStore.setSaved();
    notifyCitationChange?.(citationStateStore.getState());
    return createOkResult({ citation: citationStateStore.getState() });
  }

  function openCitation(citationPayload, options = {}) {
    const result = citationStateStore.openFromCitation(citationPayload, options);
    if (result?.ok) {
      notifyCitationChange?.(citationStateStore.getState());
    }
    return result;
  }

  function clearCitation() {
    const result = citationStateStore.clear();
    notifyCitationChange?.(citationStateStore.getState());
    return result;
  }

  return {
    getState,
    renderCitation,
    saveState,
    openCitation,
    clearCitation,
  };
}
