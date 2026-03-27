// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
const FORM_CONTROL_TAGS = new Set(["INPUT", "OPTION", "SELECT", "TEXTAREA"]);
const EDITOR_TOKENS = [
    "ace_editor",
    "codemirror",
    "editor",
    "lexical",
    "monaco",
    "prosemirror",
    "ql-editor",
    "quill",
    "slate",
    "tox-",
];
const EDITOR_ROLES = new Set(["searchbox", "spinbutton", "textbox"]);
export function isElementNode(node) {
    return Boolean(node) && typeof node === "object" && typeof node.tagName === "string";
}
function getStringAttributes(element) {
    if (!isElementNode(element) || typeof element.getAttribute !== "function") {
        return "";
    }
    const values = [
        element.id,
        element.className,
        element.getAttribute("role"),
        element.getAttribute("aria-label"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.getAttribute("data-editor"),
        element.getAttribute("data-gramm"),
        element.getAttribute("data-lexical-editor"),
    ];
    return values.filter(Boolean).join(" ").toLowerCase();
}
export function getElementFromNode(node) {
    let current = node || null;
    while (current) {
        if (isElementNode(current)) {
            return current;
        }
        current = current.parentNode || current.parentElement || current.host || null;
    }
    return null;
}
export function isFormControl(element) {
    if (!isElementNode(element)) {
        return false;
    }
    return FORM_CONTROL_TAGS.has(String(element.tagName || "").toUpperCase());
}
export function isContentEditableElement(element) {
    if (!isElementNode(element)) {
        return false;
    }
    if (typeof element.isContentEditable === "boolean" && element.isContentEditable) {
        return true;
    }
    const contentEditable = typeof element.getAttribute === "function"
        ? element.getAttribute("contenteditable")
        : element.contentEditable;
    return contentEditable === "" || contentEditable === "true" || contentEditable === "plaintext-only";
}
export function isEditorLikeElement(element) {
    if (!isElementNode(element)) {
        return false;
    }
    const label = getStringAttributes(element);
    const role = typeof element.getAttribute === "function"
        ? String(element.getAttribute("role") || "").toLowerCase()
        : "";
    if (EDITOR_ROLES.has(role)) {
        return true;
    }
    if (!label) {
        return false;
    }
    return EDITOR_TOKENS.some((token) => label.includes(token));
}
export function isEditableTarget(element) {
    return isFormControl(element) || isContentEditableElement(element) || isEditorLikeElement(element);
}
export function isWithinEditableContext(node) {
    let current = getElementFromNode(node);
    while (current) {
        if (isEditableTarget(current)) {
            return true;
        }
        current = current.parentNode || current.parentElement || current.host || null;
    }
    return false;
}
export function isSafeSelectionContext(selection, documentRef) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
        return false;
    }
    const activeElement = documentRef?.activeElement || null;
    if (isWithinEditableContext(activeElement)) {
        return false;
    }
    let range = null;
    if (typeof selection.getRangeAt === "function" && selection.rangeCount) {
        try {
            range = selection.getRangeAt(0);
        }
        catch {
            range = null;
        }
    }
    const nodes = [
        selection.anchorNode || null,
        selection.focusNode || null,
        range?.commonAncestorContainer || null,
        range?.startContainer || null,
        range?.endContainer || null,
    ];
    return !nodes.some((node) => isWithinEditableContext(node));
}
