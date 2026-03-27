// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { isContentEditableElement, isEditorLikeElement, isElementNode as sharedIsElementNode, isFormControl, isWithinEditableContext, } from "../shared/editable_context.js";
const SAFE_TEXT_TAGS = new Set([
    "A",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "CODE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "EM",
    "FIGCAPTION",
    "FIGURE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "IMG",
    "LABEL",
    "LI",
    "MAIN",
    "MARK",
    "P",
    "PRE",
    "SECTION",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TABLE",
    "TBODY",
    "TD",
    "TH",
    "THEAD",
    "TR",
]);
const INTERACTIVE_TAGS = new Set([
    "BUTTON",
    "CANVAS",
    "DIALOG",
    "DETAILS",
    "EMBED",
    "IFRAME",
    "INPUT",
    "OPTION",
    "PROGRESS",
    "SELECT",
    "SUMMARY",
    "TEXTAREA",
    "VIDEO",
    "AUDIO",
]);
export const isElementNode = sharedIsElementNode;
export function getEventPath(event) {
    if (!event) {
        return [];
    }
    if (typeof event.composedPath === "function") {
        const path = event.composedPath();
        return Array.isArray(path) ? path : [];
    }
    const path = [];
    let node = event.target || null;
    while (node) {
        path.push(node);
        node = node.parentNode || node.host || null;
    }
    return path;
}
export function firstElementFromPath(event) {
    const path = getEventPath(event);
    for (const node of path) {
        if (isElementNode(node)) {
            return node;
        }
    }
    return isElementNode(event?.target) ? event.target : null;
}
export function getElementPath(eventOrPath) {
    const rawPath = Array.isArray(eventOrPath) ? eventOrPath : getEventPath(eventOrPath);
    return rawPath.filter(isElementNode);
}
export function isSensitiveWidget(element) {
    if (!isElementNode(element)) {
        return false;
    }
    const tagName = String(element.tagName || "").toUpperCase();
    if (INTERACTIVE_TAGS.has(tagName)) {
        return true;
    }
    if (typeof element.getAttribute === "function") {
        const role = String(element.getAttribute("role") || "").toLowerCase();
        if (["button", "dialog", "listbox", "menu", "menuitem", "option", "slider", "tab", "textbox", "tooltip"].includes(role)) {
            return true;
        }
        if (String(element.getAttribute("type") || "").toLowerCase() === "file") {
            return true;
        }
        if (element.getAttribute("draggable") === "true") {
            return true;
        }
    }
    return false;
}
export function isSafeContentElement(element) {
    if (!isElementNode(element)) {
        return false;
    }
    const tagName = String(element.tagName || "").toUpperCase();
    if (!SAFE_TEXT_TAGS.has(tagName)) {
        return false;
    }
    if (isSensitiveWidget(element) || isWithinEditableContext(element)) {
        return false;
    }
    return true;
}
export function classifyTarget(target) {
    if (!isElementNode(target)) {
        return {
            kind: "unknown",
            element: null,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isFormControl(target)) {
        return {
            kind: "form-control",
            element: target,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isContentEditableElement(target)) {
        return {
            kind: "contenteditable",
            element: target,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isEditorLikeElement(target)) {
        return {
            kind: "editor",
            element: target,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isSensitiveWidget(target)) {
        return {
            kind: "sensitive-widget",
            element: target,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isSafeContentElement(target)) {
        return {
            kind: "safe-content",
            element: target,
            allowClipboardGuard: true,
            allowPassiveGuard: true,
            allowPasteGuard: true,
            allowShortcutGuard: true,
            allowContextMenuGuard: true,
            allowSelectionGuard: true,
        };
    }
    return {
        kind: "neutral",
        element: target,
        allowClipboardGuard: false,
        allowPassiveGuard: false,
        allowPasteGuard: false,
        allowShortcutGuard: false,
        allowContextMenuGuard: false,
        allowSelectionGuard: false,
    };
}
export function classifyEventPath(eventOrPath) {
    const path = getElementPath(eventOrPath);
    if (path.length === 0) {
        return classifyTarget(null);
    }
    let sawSafeContent = null;
    let sawFormControl = null;
    let sawContentEditable = null;
    for (const element of path) {
        const classification = classifyTarget(element);
        if (classification.kind === "editor" || classification.kind === "sensitive-widget") {
            return classification;
        }
        if (!sawContentEditable && classification.kind === "contenteditable") {
            sawContentEditable = classification;
        }
        if (!sawFormControl && classification.kind === "form-control") {
            sawFormControl = classification;
        }
        if (!sawSafeContent && classification.kind === "safe-content") {
            sawSafeContent = classification;
        }
    }
    return sawContentEditable || sawFormControl || sawSafeContent || classifyTarget(path[0]);
}
