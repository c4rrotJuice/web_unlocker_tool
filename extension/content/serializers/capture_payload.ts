import { extractPageMetadata } from "../dom/page_metadata.ts";

function toRect(rect = {}) {
  return {
    left: Number(rect.left || 0),
    top: Number(rect.top || 0),
    right: Number(rect.right || 0),
    bottom: Number(rect.bottom || 0),
    width: Number(rect.width || 0),
    height: Number(rect.height || 0),
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildCaptureIntentPayload({
  action = "citation",
  selectionText = "",
  pageTitle = "",
  pageUrl = "",
  pageDomain = "",
  metadata = {},
  noteText = "",
  selection = null,
} = {}) {
  const page = {
    title: normalizeText(pageTitle),
    url: String(pageUrl || ""),
    domain: String(pageDomain || "").trim(),
    description: normalizeText(metadata?.description),
    author: normalizeText(metadata?.author),
    site_name: normalizeText(metadata?.site_name),
    canonical_url: String(metadata?.canonical_url || ""),
    language: normalizeText(metadata?.language),
  };
  return {
    version: 1,
    source: "selection_pill",
    action,
    selectionText: normalizeText(selectionText),
    pageTitle: page.title,
    pageUrl: page.url,
    pageDomain: page.domain,
    metadata: {
      description: page.description,
      author: page.author,
      site_name: page.site_name,
      canonical_url: page.canonical_url,
      language: page.language,
    },
    noteText: normalizeText(noteText),
    selection: selection
      ? {
          text: selection?.text || "",
          normalized_text: selection?.normalized_text || selection?.text || "",
          length: Number(selection?.length || 0),
          word_count: Number(selection?.word_count || 0),
          line_count: Number(selection?.line_count || 0),
          rect: toRect(selection?.rect || {}),
          anchor_offset: Number(selection?.anchor_offset || 0),
          focus_offset: Number(selection?.focus_offset || 0),
          direction: selection?.direction || "forward",
          is_collapsed: Boolean(selection?.is_collapsed),
        }
      : null,
    created_at: new Date().toISOString(),
  };
}

export function buildSelectionCapturePayload({ selection, page, action = "copy" } = {}) {
  const pageMetadata = page || {};
  return {
    version: 1,
    source: "selection_pill",
    action,
    selection: {
      text: selection?.text || "",
      normalized_text: selection?.normalized_text || selection?.text || "",
      length: Number(selection?.length || 0),
      word_count: Number(selection?.word_count || 0),
      line_count: Number(selection?.line_count || 0),
      rect: toRect(selection?.rect || {}),
      anchor_offset: Number(selection?.anchor_offset || 0),
      focus_offset: Number(selection?.focus_offset || 0),
      direction: selection?.direction || "forward",
      is_collapsed: Boolean(selection?.is_collapsed),
    },
    page: {
      url: pageMetadata.url || "",
      origin: pageMetadata.origin || "",
      host: pageMetadata.host || "",
      title: pageMetadata.title || "",
      description: pageMetadata.description || "",
      author: pageMetadata.author || "",
      site_name: pageMetadata.site_name || "",
      canonical_url: pageMetadata.canonical_url || "",
      language: pageMetadata.language || "",
    },
    target: {
      tag_name: selection?.target?.tag_name || "",
      is_editable: Boolean(selection?.target?.is_editable),
      inside_extension_ui: Boolean(selection?.target?.inside_extension_ui),
    },
    ui: {
      active_action: "copy",
      available_actions: ["copy"],
      inactive_actions: ["cite", "note", "quote"],
    },
    created_at: new Date().toISOString(),
  };
}

export { extractPageMetadata };
