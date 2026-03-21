import { createErrorResult, createOkResult, ERROR_CODES } from "./messages.ts";

export const CITATION_STYLES = Object.freeze(["apa", "mla", "chicago", "harvard"]);
export const CITATION_FORMATS = Object.freeze(["inline", "footnote", "bibliography"]);

export function normalizeCitationStyle(value, fallback = "apa") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return CITATION_STYLES.includes(normalized) ? normalized : fallback;
}

export function normalizeCitationFormat(value, fallback = "bibliography") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return CITATION_FORMATS.includes(normalized) ? normalized : fallback;
}

export function normalizeCitationRenderBundle(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const renders = source.renders && typeof source.renders === "object" ? source.renders : {};
  const normalizedRenders = {};
  for (const [style, styleBundle] of Object.entries(renders)) {
    if (!CITATION_STYLES.includes(style)) {
      continue;
    }
    normalizedRenders[style] = {};
    const bundle = styleBundle && typeof styleBundle === "object" ? styleBundle : {};
    for (const format of CITATION_FORMATS) {
      if (typeof bundle[format] === "string") {
        normalizedRenders[style][format] = bundle[format];
      }
    }
  }
  return {
    source_fingerprint: source.source_fingerprint || "",
    source_version: source.source_version || "",
    citation_version: source.citation_version || "",
    render_version: source.render_version || "",
    renders: normalizedRenders,
    cache_hit: Boolean(source.cache_hit),
  };
}

export function normalizeCitationRecord(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  if (!source || typeof source !== "object") {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation record is required.");
  }
  const citationId = String(source.id || "").trim();
  if (!citationId) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Citation id is required.");
  }
  return createOkResult({
    id: citationId,
    style: normalizeCitationStyle(source.style || source.format || "apa"),
    format: normalizeCitationFormat(source.format || "bibliography"),
    inline_citation: String(source.inline_citation || ""),
    full_citation: String(source.full_citation || source.full_text || ""),
    full_text: String(source.full_text || source.full_citation || ""),
    footnote: String(source.footnote || ""),
    quote_attribution: String(source.quote_attribution || ""),
    metadata: source.metadata && typeof source.metadata === "object" ? source.metadata : {},
    source: source.source && typeof source.source === "object" ? source.source : null,
    context: source.context && typeof source.context === "object" ? source.context : {},
    citation_version: String(source.citation_version || ""),
    render_version: String(source.render_version || ""),
    source_fingerprint: String(source.source_fingerprint || ""),
    source_version: String(source.source_version || ""),
    cited_at: String(source.cited_at || ""),
  });
}

function selectCitationRenderText(record, style, format) {
  const renderBundle = record?.renders && typeof record.renders === "object" ? record.renders : null;
  const styleBundle = renderBundle?.[style] && typeof renderBundle[style] === "object" ? renderBundle[style] : null;
  if (styleBundle && typeof styleBundle[format] === "string" && styleBundle[format].trim()) {
    return styleBundle[format].trim();
  }
  if (styleBundle) {
    const orderedFormats = [format, ...CITATION_FORMATS.filter((item) => item !== format)];
    for (const candidate of orderedFormats) {
      if (typeof styleBundle[candidate] === "string" && styleBundle[candidate].trim()) {
        return styleBundle[candidate].trim();
      }
    }
  }
  const directFields = {
    inline: record?.inline_citation,
    footnote: record?.footnote,
    bibliography: record?.full_citation || record?.full_text,
  };
  return String(directFields[format] || "").trim();
}

export function getCitationPreviewText(record, style = "apa", format = "bibliography") {
  const normalizedStyle = normalizeCitationStyle(style, "apa");
  const normalizedFormat = normalizeCitationFormat(format, "bibliography");
  return selectCitationRenderText(record, normalizedStyle, normalizedFormat);
}
