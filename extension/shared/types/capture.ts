function normalizeText(value: any) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isPlainObject(value: any) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizeCandidate(candidate: any) {
  if (typeof candidate === "string") {
    const value = normalizeText(candidate);
    return value ? { value, confidence: 0.5, source: null } : null;
  }
  if (!isPlainObject(candidate)) {
    return null;
  }
  const value = normalizeText(candidate.value);
  if (!value) {
    return null;
  }
  const confidence = Number(candidate.confidence);
  return {
    value,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    source: normalizeText(candidate.source) || null,
  };
}

function normalizeCandidateList(input: any) {
  const seen = new Set();
  const normalized = [];
  for (const entry of Array.isArray(input) ? input : []) {
    const candidate = normalizeCandidate(entry);
    if (!candidate) {
      continue;
    }
    const key = `${candidate.value.toLowerCase()}|${candidate.source || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(candidate);
  }
  return normalized;
}

function normalizeIdentifiers(input: any) {
  if (!isPlainObject(input)) {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeText(key).toLowerCase();
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function normalizeLocator(input: any) {
  return isPlainObject(input) ? { ...input } : {};
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
  const canonicalUrl = normalizeText(input.canonicalUrl ?? input.canonical_url);
  const description = normalizeText(input.description);
  const language = normalizeText(input.language);
  const siteName = normalizeText(input.siteName ?? input.site_name);
  const titleCandidates = normalizeCandidateList(input.titleCandidates ?? input.title_candidates);
  const authorCandidates = normalizeCandidateList(input.authorCandidates ?? input.author_candidates);
  const dateCandidates = normalizeCandidateList(input.dateCandidates ?? input.date_candidates);
  const publisherCandidates = normalizeCandidateList(input.publisherCandidates ?? input.publisher_candidates);
  const containerCandidates = normalizeCandidateList(input.containerCandidates ?? input.container_candidates);
  const sourceTypeCandidates = normalizeCandidateList(input.sourceTypeCandidates ?? input.source_type_candidates);
  const identifiers = normalizeIdentifiers(input.identifiers);
  const locator = normalizeLocator(input.locator);
  const extractionEvidence = isPlainObject(input.extractionEvidence ?? input.extraction_evidence)
    ? (input.extractionEvidence ?? input.extraction_evidence)
    : {};
  const rawMetadata = isPlainObject(input.rawMetadata ?? input.raw_metadata)
    ? (input.rawMetadata ?? input.raw_metadata)
    : {};
  const excerpt = normalizeText(input.excerpt);
  const annotation = normalizeText(input.annotation);
  const quote = normalizeText(input.quote);

  return {
    selectionText,
    pageTitle,
    pageUrl,
    pageDomain,
    canonicalUrl,
    description,
    language,
    siteName,
    titleCandidates,
    authorCandidates,
    dateCandidates,
    publisherCandidates,
    containerCandidates,
    sourceTypeCandidates,
    identifiers,
    locator,
    extractionEvidence,
    rawMetadata,
    excerpt,
    annotation,
    quote,
  };
}

export function buildContentCapturePayload({
  selectionText,
  pageTitle,
  pageUrl,
  pageDomain,
  canonicalUrl,
  description,
  language,
  siteName,
  titleCandidates,
  authorCandidates,
  dateCandidates,
  publisherCandidates,
  containerCandidates,
  sourceTypeCandidates,
  identifiers,
  locator,
  extractionEvidence,
  rawMetadata,
  excerpt,
  annotation,
  quote,
}: any = {}) {
  return {
    capture: normalizeCaptureContext({
      selectionText,
      pageTitle,
      pageUrl,
      pageDomain,
      canonicalUrl,
      description,
      language,
      siteName,
      titleCandidates,
      authorCandidates,
      dateCandidates,
      publisherCandidates,
      containerCandidates,
      sourceTypeCandidates,
      identifiers,
      locator,
      extractionEvidence,
      rawMetadata,
      excerpt,
      annotation,
      quote,
    }),
  };
}

export function buildCaptureExtractionPayload(input: any = {}) {
  const context = normalizeCaptureContext(input);
  const rawMetadata = {
    ...context.rawMetadata,
    page_url: context.pageUrl || null,
    canonical_url: context.canonicalUrl || context.pageUrl || null,
    title: context.pageTitle || null,
    description: context.description || null,
    language: context.language || null,
    site_name: context.siteName || null,
  } as any;

  if (context.authorCandidates.length) {
    rawMetadata.authors = context.authorCandidates.map((candidate) => candidate.value);
    rawMetadata.author = rawMetadata.authors[0];
  }
  if (context.dateCandidates.length && !rawMetadata.datePublished) {
    rawMetadata.datePublished = context.dateCandidates[0].value;
  }
  if (context.containerCandidates.length && !rawMetadata.container_title) {
    rawMetadata.container_title = context.containerCandidates[0].value;
  }
  if (Object.keys(context.identifiers).length) {
    rawMetadata.identifiers = { ...context.identifiers };
  }

  return {
    identifiers: { ...context.identifiers },
    canonical_url: context.canonicalUrl || context.pageUrl || null,
    page_url: context.pageUrl || null,
    title_candidates: context.titleCandidates.length
      ? context.titleCandidates
      : (context.pageTitle ? [{ value: context.pageTitle, confidence: 0.9, source: "document.title" }] : []),
    author_candidates: context.authorCandidates,
    date_candidates: context.dateCandidates,
    publisher_candidates: context.publisherCandidates.length
      ? context.publisherCandidates
      : (context.siteName
        ? [{ value: context.siteName, confidence: 0.6, source: "page.site_name" }]
        : (context.pageDomain ? [{ value: context.pageDomain, confidence: 0.4, source: "page.domain" }] : [])),
    container_candidates: context.containerCandidates,
    source_type_candidates: context.sourceTypeCandidates.length
      ? context.sourceTypeCandidates
      : [{ value: "webpage", confidence: 0.8, source: "extension.capture" }],
    selection_text: context.selectionText || null,
    locator: context.locator,
    extraction_evidence: {
      ...context.extractionEvidence,
      capture_source: "extension_selection",
      page_domain: context.pageDomain || null,
      canonical_url: context.canonicalUrl || context.pageUrl || null,
    },
    raw_metadata: rawMetadata,
  };
}

export function buildCitationCaptureRequest(input: any = {}) {
  const context = normalizeCaptureContext(input);
  return {
    extraction_payload: buildCaptureExtractionPayload(context),
    excerpt: context.excerpt || context.selectionText || null,
    locator: context.locator,
    annotation: context.annotation || null,
    quote: context.quote || context.selectionText || null,
  };
}

export function buildQuoteCaptureRequest({
  citationId,
  selectionText,
  locator,
  annotation,
}: any = {}) {
  return {
    citation_id: normalizeText(citationId),
    excerpt: normalizeText(selectionText),
    locator: normalizeLocator(locator),
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
