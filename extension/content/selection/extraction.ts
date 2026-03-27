import {
  getElementFromNode,
  isSafeSelectionContext,
  isWithinEditableContext,
} from "../shared/editable_context.ts";

const EXTENSION_UI_ATTR = "data-writior-extension-ui";
const MINIMUM_WORD_CHARS = 3;

function normalizeWhitespace(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getSelectionRange(selection: any) {
  if (!selection || typeof selection.getRangeAt !== "function" || !selection.rangeCount) {
    return null;
  }
  try {
    return selection.getRangeAt(0);
  } catch {
    return null;
  }
}

function toRect(rect: any = {}) {
  const left = Number(rect.left || 0);
  const top = Number(rect.top || 0);
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  const right = "right" in rect ? Number(rect.right || left + width) : left + width;
  const bottom = "bottom" in rect ? Number(rect.bottom || top + height) : top + height;
  return { left, top, right, bottom, width, height };
}

function rectFromRange(range: any) {
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
    const rects = range.getClientRects();
    const firstRect = rects?.[0] || null;
    if (firstRect) {
      return toRect(firstRect);
    }
  }
  return null;
}

function isValidRect(rect: any) {
  return Boolean(rect) && rect.width >= 0 && rect.height >= 0 && (rect.width > 0 || rect.height > 0);
}

function isInsideExtensionUi(node: any) {
  let current = getElementFromNode(node);
  while (current) {
    if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
      return true;
    }
    current = current.parentNode || current.parentElement || null;
  }
  return false;
}

function isUnsafeSelectionContainer(element: any) {
  if (!element || typeof element.tagName !== "string") {
    return false;
  }
  const tagName = String(element.tagName || "").toUpperCase();
  if (["BUTTON", "CANVAS", "DIALOG", "EMBED", "IFRAME", "SELECT", "TEXTAREA", "VIDEO", "AUDIO"].includes(tagName)) {
    return true;
  }
  if (isWithinEditableContext(element)) {
    return true;
  }
  const role = typeof element.getAttribute === "function"
    ? String(element.getAttribute("role") || "").toLowerCase()
    : "";
  return ["button", "dialog", "listbox", "menu", "menuitem", "slider", "tab", "textbox", "tooltip"].includes(role);
}

function hasEnoughSignal(text: string, minimumLength: number) {
  if (text.length < minimumLength) {
    return false;
  }
  const wordChars = (text.match(/[A-Za-z0-9]/g) || []).length;
  return wordChars >= Math.min(MINIMUM_WORD_CHARS, minimumLength);
}

export function extractNormalizedSelection({
  documentRef = globalThis.document,
  minimumLength = 3,
} = {}) {
  const selection = documentRef?.getSelection?.();
  if (!isSafeSelectionContext(selection, documentRef)) {
    return null;
  }
  const range = getSelectionRange(selection);
  if (!range) {
    return null;
  }

  const text = String(selection.toString ? selection.toString() : "");
  const normalizedText = normalizeWhitespace(text);
  if (!hasEnoughSignal(normalizedText, minimumLength)) {
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
  if (
    isInsideExtensionUi(targetElement)
    || isInsideExtensionUi(anchorElement)
    || isInsideExtensionUi(focusElement)
  ) {
    return null;
  }
  if (
    isUnsafeSelectionContainer(targetElement)
    || isUnsafeSelectionContainer(anchorElement)
    || isUnsafeSelectionContainer(focusElement)
  ) {
    return null;
  }

  const rect = rectFromRange(range);
  if (!isValidRect(rect)) {
    return null;
  }

  const anchorOffset = Number(selection.anchorOffset || 0);
  const focusOffset = Number(selection.focusOffset || 0);

  return {
    text: normalizedText,
    normalized_text: normalizedText,
    length: normalizedText.length,
    word_count: normalizedText ? normalizedText.split(/\s+/).filter(Boolean).length : 0,
    line_count: text ? String(text).split(/\n+/).filter(Boolean).length : 0,
    rect,
    anchor_offset: anchorOffset,
    focus_offset: focusOffset,
    is_collapsed: Boolean(selection.isCollapsed),
    direction: focusOffset >= anchorOffset ? "forward" : "backward",
    target: {
      tag_name: typeof targetElement.tagName === "string" ? targetElement.tagName.toLowerCase() : "",
      is_editable: isWithinEditableContext(targetElement),
      inside_extension_ui: false,
    },
  };
}

export function selectionSignature(snapshot: any) {
  if (!snapshot) {
    return "";
  }
  const rect = snapshot.rect || {};
  return [
    snapshot.normalized_text || snapshot.text || "",
    snapshot.anchor_offset ?? 0,
    snapshot.focus_offset ?? 0,
    rect.left ?? 0,
    rect.top ?? 0,
    rect.width ?? 0,
    rect.height ?? 0,
  ].join("|");
}
