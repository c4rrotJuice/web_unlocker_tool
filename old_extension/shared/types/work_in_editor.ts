import { createErrorResult, createOkResult, ERROR_CODES } from "./messages.ts";

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

function normalizeMetadata(source = {}, fallback = {}) {
  return {
    description: normalizeText(source.description ?? fallback.description),
    author: normalizeText(source.author ?? fallback.author),
    site_name: normalizeText(source.site_name ?? fallback.site_name),
    canonical_url: normalizeUrl(source.canonical_url ?? fallback.canonical_url),
    language: normalizeText(source.language ?? fallback.language),
  };
}

function pickEntityText(entity) {
  if (!entity || typeof entity !== "object") {
    return "";
  }
  const candidates = [
    entity.selectionText,
    entity.selection_text,
    entity.text,
    entity.preview_text,
    entity.noteText,
    entity.note_text,
    entity.note_body,
    entity.body,
    entity.quote_text,
    entity.full_text,
    entity.full_citation,
    entity.inline_citation,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function extractEntityPageUrl(entity) {
  if (!entity || typeof entity !== "object") {
    return "";
  }
  return normalizeUrl(
    entity.pageUrl
      ?? entity.page_url
      ?? entity.url
      ?? entity.source?.url
      ?? entity.source?.page_url
      ?? entity.metadata?.canonical_url
      ?? entity.source?.canonical_url
      ?? "",
  );
}

function extractEntityPageTitle(entity) {
  if (!entity || typeof entity !== "object") {
    return "";
  }
  return normalizeText(
    entity.pageTitle
      ?? entity.page_title
      ?? entity.title
      ?? entity.source?.title
      ?? entity.metadata?.title
      ?? "",
  );
}

function extractEntityPageDomain(entity, pageUrl) {
  if (!entity || typeof entity !== "object") {
    return normalizePageDomain(pageUrl, "");
  }
  return normalizePageDomain(
    pageUrl,
    entity.pageDomain
      ?? entity.page_domain
      ?? entity.hostname
      ?? entity.source?.hostname
      ?? entity.source?.host
      ?? entity.source?.domain
      ?? "",
  );
}

function normalizeEntity(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }
  return entity;
}

export function buildWorkInEditorPayload({
  selectionText = "",
  pageTitle = "",
  pageUrl = "",
  pageDomain = "",
  metadata = {},
  noteText = "",
  commentaryText = "",
  entity = null,
  action = "work_in_editor",
  source = "selection_pill",
  selection = null,
} = {}) {
  const entityPageUrl = extractEntityPageUrl(entity);
  const resolvedPageUrl = normalizeUrl(pageUrl || entityPageUrl);
  const entityPageTitle = extractEntityPageTitle(entity);
  const resolvedPageTitle = normalizeText(pageTitle || entityPageTitle);
  const resolvedPageDomain = normalizePageDomain(resolvedPageUrl, pageDomain || extractEntityPageDomain(entity, resolvedPageUrl));
  const entityMetadata = entity && typeof entity === "object" ? (entity.metadata && typeof entity.metadata === "object" ? entity.metadata : {}) : {};
  const resolvedMetadata = normalizeMetadata(metadata, entityMetadata);
  const selectionCandidate = normalizeText(selectionText || pickEntityText(entity));
  const commentaryCandidate = normalizeText(commentaryText || noteText || entity?.commentary || entity?.noteText || entity?.note_body || "");

  return {
    version: 1,
    source,
    action,
    selectionText: selectionCandidate,
    pageTitle: resolvedPageTitle,
    pageUrl: resolvedPageUrl,
    pageDomain: resolvedPageDomain,
    metadata: resolvedMetadata,
    noteText: commentaryCandidate,
    commentaryText: commentaryCandidate,
    entity: normalizeEntity(entity),
    selection: selection
      ? {
          text: selection?.text || "",
          normalized_text: selection?.normalized_text || selection?.text || "",
          length: Number(selection?.length || 0),
          word_count: Number(selection?.word_count || 0),
          line_count: Number(selection?.line_count || 0),
          rect: selection?.rect || null,
          anchor_offset: Number(selection?.anchor_offset || 0),
          focus_offset: Number(selection?.focus_offset || 0),
          direction: selection?.direction || "forward",
          is_collapsed: Boolean(selection?.is_collapsed),
        }
      : null,
    created_at: new Date().toISOString(),
  };
}

export function normalizeWorkInEditorRequest(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const entity = normalizeEntity(source.entity ?? source.citation ?? source.note ?? source.quote ?? null);
  const selectionText = normalizeText(source.selectionText ?? source.selection_text ?? source.text ?? source.selection?.text ?? source.selection?.normalized_text ?? pickEntityText(entity));
  const noteText = normalizeText(source.noteText ?? source.note_text ?? source.body ?? source.commentaryText ?? source.commentary_text ?? source.commentary ?? "");
  const pageTitle = normalizeText(source.pageTitle ?? source.page_title ?? source.page?.title ?? extractEntityPageTitle(entity));
  const pageUrl = normalizeUrl(source.pageUrl ?? source.page_url ?? source.page?.url ?? extractEntityPageUrl(entity));
  const pageDomain = normalizePageDomain(pageUrl, source.pageDomain ?? source.page_domain ?? source.page?.domain ?? source.page?.host ?? extractEntityPageDomain(entity, pageUrl));
  const metadata = normalizeMetadata(source.metadata && typeof source.metadata === "object" ? source.metadata : {}, entity?.metadata && typeof entity.metadata === "object" ? entity.metadata : {});
  const commentaryText = normalizeText(source.commentaryText ?? source.commentary_text ?? noteText);

  if (!selectionText && !commentaryText && !entity) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Selection text, commentary, or an entity is required.", null, { kind: "work_in_editor" });
  }

  return createOkResult({
    kind: "work_in_editor",
    action: source.action || "work_in_editor",
    selectionText,
    pageTitle,
    pageUrl,
    pageDomain,
    metadata,
    noteText: commentaryText,
    commentaryText,
    entity,
    raw: source,
  });
}

export function normalizeWorkInEditorResponse(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : null;
  if (!source) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "Work-in-editor response is required.");
  }
  const editorUrl = normalizeUrl(source.editor_url ?? source.editorUrl);
  const documentId = normalizeText(source.document_id ?? source.documentId);
  if (!editorUrl) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "editor_url is required in the work-in-editor response.");
  }
  if (!documentId) {
    return createErrorResult(ERROR_CODES.INVALID_PAYLOAD, "document_id is required in the work-in-editor response.");
  }
  return createOkResult({
    document_id: documentId,
    seed: source.seed ?? null,
    redirect_path: typeof source.redirect_path === "string" ? source.redirect_path : "",
    editor_path: typeof source.editor_path === "string" ? source.editor_path : "",
    editor_url: editorUrl,
    document: source.document && typeof source.document === "object" ? source.document : source.document ?? null,
    citation: source.citation && typeof source.citation === "object" ? source.citation : source.citation ?? null,
    quote: source.quote && typeof source.quote === "object" ? source.quote : source.quote ?? null,
    note: source.note && typeof source.note === "object" ? source.note : source.note ?? null,
  }, source.meta ?? null);
}
