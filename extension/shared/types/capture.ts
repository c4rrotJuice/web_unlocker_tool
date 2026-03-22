function normalizeText(value: any) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateText(value: any, maxLength = 80) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function deriveDomain(pageUrl: any, explicitDomain = "") {
  const normalizedDomain = normalizeText(explicitDomain).toLowerCase();
  if (normalizedDomain) {
    return normalizedDomain;
  }
  const normalizedUrl = normalizeText(pageUrl);
  if (!normalizedUrl) {
    return "";
  }
  try {
    return new URL(normalizedUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function buildExternalNoteSource({
  pageUrl,
  pageDomain,
  pageTitle,
}: any = {}) {
  const url = normalizeText(pageUrl);
  if (!url) {
    return [];
  }
  return [{
    relation_type: "external",
    url,
    hostname: deriveDomain(url, pageDomain) || null,
    title: normalizeText(pageTitle) || null,
    position: 0,
  }];
}

export const CAPTURE_TYPES = Object.freeze({
  CITATION: "citation",
  QUOTE: "quote",
  NOTE: "note",
});

export function normalizeCaptureContext(input: any = {}) {
  const selectionText = normalizeText(input.selectionText);
  const pageTitle = normalizeText(input.pageTitle);
  const pageUrl = normalizeText(input.pageUrl);
  const pageDomain = deriveDomain(pageUrl, input.pageDomain);

  return {
    selectionText,
    pageTitle,
    pageUrl,
    pageDomain,
  };
}

export function buildContentCapturePayload({
  selectionText,
  pageTitle,
  pageUrl,
  pageDomain,
}: any = {}) {
  return {
    capture: normalizeCaptureContext({
      selectionText,
      pageTitle,
      pageUrl,
      pageDomain,
    }),
  };
}

export function buildCaptureExtractionPayload(input: any = {}) {
  const context = normalizeCaptureContext(input);
  return {
    identifiers: {},
    canonical_url: context.pageUrl || null,
    page_url: context.pageUrl || null,
    title_candidates: context.pageTitle
      ? [{ value: context.pageTitle, confidence: 0.9, source: "document.title" }]
      : [],
    author_candidates: [],
    date_candidates: [],
    publisher_candidates: context.pageDomain
      ? [{ value: context.pageDomain, confidence: 0.4, source: "page.domain" }]
      : [],
    container_candidates: [],
    source_type_candidates: [{ value: "webpage", confidence: 0.8, source: "extension.capture" }],
    selection_text: context.selectionText || null,
    locator: {},
    extraction_evidence: {
      capture_source: "extension_selection",
      page_domain: context.pageDomain || null,
    },
    raw_metadata: {
      title: context.pageTitle || null,
      page_domain: context.pageDomain || null,
    },
  };
}

export function buildCitationCaptureRequest(input: any = {}) {
  const context = normalizeCaptureContext(input);
  return {
    extraction_payload: buildCaptureExtractionPayload(context),
    excerpt: context.selectionText || null,
    locator: {},
  };
}

export function buildQuoteCaptureRequest({
  citationId,
  selectionText,
  annotation,
}: any = {}) {
  return {
    citation_id: normalizeText(citationId),
    excerpt: normalizeText(selectionText),
    locator: {},
    annotation: normalizeText(annotation) || null,
  };
}

export function buildNoteCaptureRequest({
  selectionText,
  noteText,
  pageTitle,
  pageUrl,
  pageDomain,
  citationId = null,
  quoteId = null,
}: any = {}) {
  const normalizedSelection = normalizeText(selectionText);
  const normalizedBody = normalizeText(noteText) || normalizedSelection;
  const titleSeed = normalizedBody || normalizeText(pageTitle) || "Captured note";

  return {
    title: truncateText(titleSeed, 72) || "Captured note",
    note_body: normalizedBody,
    highlight_text: normalizedSelection || null,
    citation_id: normalizeText(citationId) || null,
    quote_id: normalizeText(quoteId) || null,
    tag_ids: [],
    sources: buildExternalNoteSource({ pageUrl, pageDomain, pageTitle }),
    linked_note_ids: [],
  };
}
