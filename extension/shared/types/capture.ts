import { createErrorResult, createOkResult, ERROR_CODES } from "./messages.ts";

export const CAPTURE_KIND = Object.freeze({
  CITATION: "citation",
  QUOTE: "quote",
  NOTE: "note",
});

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(value) {
  return String(value || "").trim();
}

function normalizePageDomain(pageUrl, pageDomain) {
  if (pageDomain) {
    return String(pageDomain).trim();
  }
  try {
    return pageUrl ? new URL(pageUrl).host : "";
  } catch {
    return "";
  }
}

export function normalizeCaptureIntent(payload = {}, kind = CAPTURE_KIND.CITATION) {
  const source = payload && typeof payload === "object" ? payload : {};
  const selectionText = normalizeText(source.selectionText ?? source.selection_text ?? source.text ?? source.selection?.text);
  const pageTitle = normalizeText(source.pageTitle ?? source.page_title ?? source.page?.title);
  const pageUrl = normalizeUrl(source.pageUrl ?? source.page_url ?? source.page?.url);
  const pageDomain = normalizePageDomain(pageUrl, source.pageDomain ?? source.page_domain ?? source.page?.domain ?? source.page?.host);
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const pageMetadata = {
    description: normalizeText(metadata.description ?? source.page?.description),
    author: normalizeText(metadata.author ?? source.page?.author),
    site_name: normalizeText(metadata.site_name ?? source.page?.site_name),
    canonical_url: normalizeUrl(metadata.canonical_url ?? source.page?.canonical_url),
    language: normalizeText(metadata.language ?? source.page?.language),
  };
  const noteText = normalizeText(source.noteText ?? source.note_text ?? source.body ?? "");
  const action = source.action || kind;

  if (!pageUrl) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "A page URL is required.", null, { kind });
  }
  if (!pageDomain) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "A page domain is required.", null, { kind });
  }
  if (kind !== CAPTURE_KIND.NOTE && !selectionText) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Selection text is required for this capture.", null, { kind });
  }
  if (kind === CAPTURE_KIND.NOTE && !selectionText && !noteText) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Note text or selection text is required.", null, { kind });
  }

  return createOkResult({
    kind,
    action,
    selectionText,
    pageTitle,
    pageUrl,
    pageDomain,
    metadata: pageMetadata,
    noteText,
    raw: source,
  });
}

export function createCaptureEnvelope(kind, intent, meta = undefined) {
  return createOkResult({
    kind,
    intent,
  }, meta);
}
