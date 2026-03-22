import { isEditableElement } from "../utils/dom_utils.ts";

const EXTENSION_UI_ATTR = "data-writior-extension-ui";

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getElementFromNode(node) {
  let current = node || null;
  while (current) {
    if (typeof current.tagName === "string") {
      return current;
    }
    current = current.parentNode || current.parentElement || null;
  }
  return null;
}

function isInsideExtensionUi(node) {
  let current = getElementFromNode(node);
  while (current) {
    if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
      return true;
    }
    current = current.parentNode || current.parentElement || null;
  }
  return false;
}

function getSelectionRange(selection) {
  if (!selection || typeof selection.getRangeAt !== "function" || !selection.rangeCount) {
    return null;
  }
  try {
    return selection.getRangeAt(0);
  } catch {
    return null;
  }
}

function toRect(rect = {}) {
  const left = Number(rect.left || 0);
  const top = Number(rect.top || 0);
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  const right = "right" in rect ? Number(rect.right || left + width) : left + width;
  const bottom = "bottom" in rect ? Number(rect.bottom || top + height) : top + height;
  return { left, top, right, bottom, width, height };
}

function rectFromRange(range) {
  if (!range) {
    return null;
  }
  if (typeof range.getBoundingClientRect === "function") {
    const rect = range.getBoundingClientRect();
    if (rect) {
      return toRect(rect);
    }
  }
  if (typeof range.getClientRects === "function") {
    const clientRects = range.getClientRects();
    if (clientRects && clientRects.length > 0) {
      return toRect(clientRects[0]);
    }
  }
  return null;
}

function isValidRect(rect) {
  return Boolean(rect) && rect.width >= 0 && rect.height >= 0 && (rect.width > 0 || rect.height > 0);
}

export function extractNormalizedSelection({ documentRef = globalThis.document, minimumLength = 3 } = {}) {
  const selection = documentRef?.getSelection?.();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }
  const range = getSelectionRange(selection);
  if (!range) {
    return null;
  }
  const text = normalizeWhitespace(selection.toString ? selection.toString() : "");
  if (text.length < minimumLength) {
    return null;
  }

  const anchorNode = selection.anchorNode || range.startContainer || null;
  const focusNode = selection.focusNode || range.endContainer || null;
  const anchorElement = getElementFromNode(anchorNode);
  const focusElement = getElementFromNode(focusNode);
  const commonElement = getElementFromNode(range.commonAncestorContainer || anchorElement || focusElement);
  const targetElement = commonElement || anchorElement || focusElement || null;

  if (!targetElement) {
    return null;
  }
  if (isInsideExtensionUi(targetElement) || isInsideExtensionUi(anchorElement) || isInsideExtensionUi(focusElement)) {
    return null;
  }
  if (isEditableElement(targetElement) || isEditableElement(anchorElement) || isEditableElement(focusElement)) {
    return null;
  }

  const rect = rectFromRange(range);
  if (!isValidRect(rect)) {
    return null;
  }

  const anchorOffset = Number(selection.anchorOffset || 0);
  const focusOffset = Number(selection.focusOffset || 0);

  return {
    text,
    normalized_text: text,
    length: text.length,
    word_count: text ? text.split(/\s+/).filter(Boolean).length : 0,
    line_count: text ? text.split(/\n+/).filter(Boolean).length : 0,
    rect,
    anchor_offset: anchorOffset,
    focus_offset: focusOffset,
    is_collapsed: Boolean(selection.isCollapsed),
    direction: focusOffset >= anchorOffset ? "forward" : "backward",
    target: {
      tag_name: typeof targetElement.tagName === "string" ? targetElement.tagName.toLowerCase() : "",
      is_editable: false,
      inside_extension_ui: false,
    },
  };
}

export function selectionSignature(snapshot) {
  if (!snapshot) {
    return "";
  }
  const rect = snapshot.rect || {};
  return [
    snapshot.normalized_text || "",
    snapshot.anchor_offset ?? 0,
    snapshot.focus_offset ?? 0,
    rect.left ?? 0,
    rect.top ?? 0,
    rect.width ?? 0,
    rect.height ?? 0,
  ].join("|");
}
