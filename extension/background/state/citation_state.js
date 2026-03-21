import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { normalizeCitationRecord, normalizeCitationRenderBundle, normalizeCitationStyle, normalizeCitationFormat } from "../../shared/types/citation.js";

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createCitationStateStore(initialState = {}) {
  let state = {
    status: "idle",
    visible: false,
    citation: null,
    render_bundle: null,
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: [],
    loading: false,
    error: null,
    saved: false,
    saved_at: null,
    source: null,
    ...clone(initialState),
  };

  function setState(nextState) {
    state = {
      ...state,
      ...clone(nextState),
    };
    return getState();
  }

  function setIdle() {
    return setState({ status: "idle", visible: false, loading: false, error: null });
  }

  function openFromCitation(citationPayload, { locked_styles = [] } = {}) {
    const normalized = normalizeCitationRecord(citationPayload);
    if (!normalized.ok) {
      return normalized;
    }
    const citation = normalized.data;
    return setState({
      status: "ready",
      visible: true,
      citation,
      selected_style: normalizeCitationStyle(citation.style || "apa"),
      selected_format: normalizeCitationFormat(citation.format || "bibliography"),
      locked_styles: Array.isArray(locked_styles) ? locked_styles.filter(Boolean) : [],
      loading: false,
      error: null,
      saved: false,
      saved_at: null,
      source: citation.source || null,
      render_bundle: citation.render_bundle ? normalizeCitationRenderBundle(citation.render_bundle) : null,
    });
  }

  function setLoading(message = "Loading citation preview") {
    setState({ status: "loading", loading: true, error: null, loading_message: message });
    return createOkResult({ citation: getState() });
  }

  function setRenderBundle(bundle, next = {}) {
    setState({
      status: "ready",
      visible: true,
      loading: false,
      error: null,
      render_bundle: normalizeCitationRenderBundle(bundle),
      citation: next.citation ? clone(next.citation) : state.citation,
      selected_style: normalizeCitationStyle(next.style || state.selected_style),
      selected_format: normalizeCitationFormat(next.format || state.selected_format),
    });
    return createOkResult({ citation: getState() });
  }

  function setError(error, reason = "citation_error") {
    const normalized = error && typeof error === "object" && error.code
      ? error
      : { code: ERROR_CODES.INVALID_PAYLOAD, message: "Citation preview failed.", details: error ?? null };
    setState({
      status: "error",
      visible: true,
      loading: false,
      error: normalized,
      reason,
    });
    return createErrorResult(normalized.code, normalized.message, normalized.details, { citation: getState() });
  }

  function setSelection({ style, format }) {
    setState({
      selected_style: normalizeCitationStyle(style, state.selected_style),
      selected_format: normalizeCitationFormat(format, state.selected_format),
    });
    return createOkResult({ citation: getState() });
  }

  function setSaved() {
    setState({
      saved: true,
      saved_at: new Date().toISOString(),
    });
    return createOkResult({ citation: getState() });
  }

  function clear() {
    setIdle();
    return createOkResult({ citation: getState() });
  }

  function getState() {
    return clone(state);
  }

  return {
    getState,
    setState,
    setIdle,
    openFromCitation,
    setLoading,
    setRenderBundle,
    setError,
    setSelection,
    setSaved,
    clear,
  };
}
