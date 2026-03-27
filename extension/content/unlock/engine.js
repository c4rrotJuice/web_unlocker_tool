// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { classifyEventPath, classifyTarget, firstElementFromPath, getElementPath, getEventPath, isElementNode, } from "./dom.js";
import { isWithinEditableContext } from "../shared/editable_context.js";
const STYLE_ID = "writior-copy-unlock-style";
const DEBUG_KEY = "__WRITIOR_COPY_UNLOCK_DEBUG";
const OVERLAY_ATTR = "data-writior-unlock-overlay";
const HISTORY_PATCHED = Symbol("writior.unlock.history.patched");
const INLINE_BLOCKER_PROPS = [
    "oncopy",
    "oncut",
    "onpaste",
    "oncontextmenu",
    "onselectstart",
    "ondragstart",
];
const OPTIONAL_INLINE_PROPS = ["onmousedown", "onclick", "onmouseup"];
const INLINE_BLOCKER_ATTRS = [...INLINE_BLOCKER_PROPS];
const INLINE_OPTIONAL_ATTRS = [...OPTIONAL_INLINE_PROPS];
const STYLE_BLOCKER_PROPS = [
    ["userSelect", "user-select"],
    ["webkitUserSelect", "-webkit-user-select"],
    ["MozUserSelect", "-moz-user-select"],
    ["webkitTouchCallout", "-webkit-touch-callout"],
];
const MODE_PROFILES = {
    safe: {
        clearOptionalInlineHandlers: false,
        broadenNeutralCleanup: false,
        guardMouseUp: false,
        guardAuxClick: false,
        guardKeyUp: false,
    },
    balanced: {
        clearOptionalInlineHandlers: true,
        broadenNeutralCleanup: true,
        guardMouseUp: true,
        guardAuxClick: true,
        guardKeyUp: true,
    },
    aggressive: {
        clearOptionalInlineHandlers: true,
        broadenNeutralCleanup: true,
        guardMouseUp: true,
        guardAuxClick: true,
        guardKeyUp: true,
    },
};
function createStyleText() {
    return `
    html, body {
      -webkit-touch-callout: default !important;
    }
    :where(article, aside, blockquote, code, dd, div, dl, dt, figcaption, figure, h1, h2, h3, h4, h5, h6, li, main, p, pre, section, span, strong, sub, sup, table, tbody, td, th, thead, tr, a, img) {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      user-select: text !important;
      -webkit-touch-callout: default !important;
    }
    :where(input, textarea, select, option, button, canvas, video, audio, iframe, [contenteditable], [draggable="true"], [role="button"], [role="dialog"], [role="slider"], [role="tab"], [role="textbox"]) {
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      user-select: auto !important;
    }
    [${OVERLAY_ATTR}="off"] {
      pointer-events: none !important;
    }
  `;
}
function callStop(event) {
    if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
    }
    else if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
    }
}
function isShortcutKey(event) {
    const key = String(event?.key || "").toLowerCase();
    if (!(event?.ctrlKey || event?.metaKey)) {
        return false;
    }
    return key === "c" || key === "x" || key === "v";
}
function isModalLike(element) {
    if (!isElementNode(element) || typeof element.getAttribute !== "function") {
        return false;
    }
    const label = [
        element.id,
        element.className,
        element.getAttribute("role"),
        element.getAttribute("aria-modal"),
        element.getAttribute("data-state"),
    ].filter(Boolean).join(" ").toLowerCase();
    if (element.tagName === "DIALOG" || element.open) {
        return true;
    }
    return ["backdrop", "dialog", "drawer", "menu", "modal", "popover", "toast", "tooltip"].some((token) => label.includes(token));
}
function shouldSkipOverlayMitigation(element, documentRef, windowRef) {
    if (!isElementNode(element)) {
        return true;
    }
    if (isModalLike(element)) {
        return true;
    }
    if (typeof documentRef?.body?.getAttribute === "function") {
        const bodyClass = String(documentRef.body.className || "").toLowerCase();
        if (bodyClass.includes("modal-open") || bodyClass.includes("dialog-open")) {
            return true;
        }
    }
    const style = typeof windowRef?.getComputedStyle === "function" ? windowRef.getComputedStyle(element) : element.style || {};
    const pointerEvents = String(style?.pointerEvents || "").toLowerCase();
    if (pointerEvents === "none") {
        return true;
    }
    return false;
}
function isSuspiciousOverlay(element, documentRef, windowRef) {
    if (!isElementNode(element) || element === documentRef?.documentElement || element === documentRef?.body) {
        return false;
    }
    if (shouldSkipOverlayMitigation(element, documentRef, windowRef)) {
        return false;
    }
    const style = typeof windowRef?.getComputedStyle === "function" ? windowRef.getComputedStyle(element) : element.style || {};
    const position = String(style?.position || "").toLowerCase();
    const opacity = Number.parseFloat(String(style?.opacity || "1"));
    const backgroundColor = String(style?.backgroundColor || "").toLowerCase();
    const zIndex = Number.parseInt(String(style?.zIndex || "0"), 10) || 0;
    const pointerEvents = String(style?.pointerEvents || "").toLowerCase();
    const visibility = String(style?.visibility || "").toLowerCase();
    const display = String(style?.display || "").toLowerCase();
    if (visibility === "hidden" || display === "none" || pointerEvents === "none") {
        return false;
    }
    const suspiciousPosition = position === "fixed" || position === "absolute";
    const suspiciousOpacity = opacity <= 0.05 || backgroundColor === "transparent" || backgroundColor === "rgba(0, 0, 0, 0)";
    return suspiciousPosition && suspiciousOpacity && zIndex >= 100;
}
function getElementsFromPoint(documentRef, x, y) {
    if (typeof documentRef?.elementsFromPoint === "function") {
        const elements = documentRef.elementsFromPoint(x, y);
        return Array.isArray(elements) ? elements.filter(isElementNode) : [];
    }
    if (typeof documentRef?.elementFromPoint === "function") {
        const element = documentRef.elementFromPoint(x, y);
        return element ? [element] : [];
    }
    return [];
}
export function createPageUnlockEngine(options = {}) {
    const typedOptions = options;
    const documentRef = typedOptions.documentRef || globalThis.document;
    const windowRef = typedOptions.windowRef || globalThis.window;
    const MutationObserverRef = typedOptions.MutationObserverRef || globalThis.MutationObserver;
    const queueMicrotaskRef = typedOptions.queueMicrotaskRef || globalThis.queueMicrotask?.bind(globalThis) || ((callback) => Promise.resolve().then(callback));
    const config = {
        enabled: typedOptions.enabled !== false,
        mode: typedOptions.mode || "balanced",
        restoreSelection: typedOptions.restoreSelection !== false,
        restoreClipboard: typedOptions.restoreClipboard !== false,
        restoreContextMenu: typedOptions.restoreContextMenu !== false,
        restorePassiveClicks: typedOptions.restorePassiveClicks !== false,
        overlayMitigation: typedOptions.overlayMitigation || "conservative",
    };
    const profile = MODE_PROFILES[config.mode] || MODE_PROFILES.balanced;
    const debug = typedOptions.debug === true;
    const listeners = [];
    const cleanupHandlers = [];
    const processedNodes = new WeakSet();
    const overlayMitigated = new WeakSet();
    const queuedNodes = new Set();
    const state = {
        enabled: false,
        bootstrapCount: 0,
        styleInstallCount: 0,
        guardInstallCount: 0,
        inlineCleanupCount: 0,
        styleRecoveryCount: 0,
        overlayMitigationCount: 0,
        mutationBatchCount: 0,
        routeChangeCount: 0,
        listenerCount: 0,
        processedNodeCount: 0,
        observerActive: false,
    };
    let observer = null;
    let flushQueued = false;
    let historyCleanup = null;
    let currentUrl = String(windowRef?.location?.href || "");
    function updateDebugHook() {
        if (!debug || !windowRef) {
            return;
        }
        windowRef[DEBUG_KEY] = {
            mode: config.mode,
            config,
            installed: state.enabled,
            counters: {
                bootstrapCount: state.bootstrapCount,
                styleInstallCount: state.styleInstallCount,
                guardInstallCount: state.guardInstallCount,
                inlineCleanupCount: state.inlineCleanupCount,
                styleRecoveryCount: state.styleRecoveryCount,
                overlayMitigationCount: state.overlayMitigationCount,
                mutationBatchCount: state.mutationBatchCount,
                routeChangeCount: state.routeChangeCount,
            },
        };
    }
    function addListener(target, type, handler, optionsValue = true) {
        if (!target?.addEventListener) {
            return;
        }
        target.addEventListener(type, handler, optionsValue);
        listeners.push(() => target.removeEventListener?.(type, handler, optionsValue));
        state.listenerCount += 1;
    }
    function installStyleOverrides() {
        const parent = documentRef?.head || documentRef?.documentElement || documentRef?.body;
        if (!parent) {
            return null;
        }
        const existing = documentRef.getElementById?.(STYLE_ID);
        if (existing) {
            return existing;
        }
        const styleNode = documentRef.createElement("style");
        styleNode.id = STYLE_ID;
        styleNode.textContent = createStyleText();
        parent.appendChild(styleNode);
        state.styleInstallCount += 1;
        updateDebugHook();
        return styleNode;
    }
    function clearInlineProps(node, properties) {
        let cleared = 0;
        for (const property of properties) {
            if (typeof node?.[property] === "function") {
                node[property] = null;
                cleared += 1;
            }
        }
        return cleared;
    }
    function clearInlineAttributes(node, attributes) {
        if (typeof node?.removeAttribute !== "function") {
            return 0;
        }
        let cleared = 0;
        for (const attribute of attributes) {
            if (node.getAttribute?.(attribute) !== null) {
                node.removeAttribute(attribute);
                cleared += 1;
            }
        }
        return cleared;
    }
    function recoverInlineStyles(node, classification) {
        if (!node?.style) {
            return 0;
        }
        const desiredSelection = classification.kind === "form-control" || classification.kind === "contenteditable" ? "auto" : "text";
        let changed = 0;
        for (const [property, cssProperty] of STYLE_BLOCKER_PROPS) {
            const value = String(node.style[property] || "").toLowerCase();
            if (!value) {
                continue;
            }
            if (property === "webkitTouchCallout") {
                if (value === "none") {
                    if (node.style.setProperty) {
                        node.style.setProperty(cssProperty, "default", "important");
                    }
                    else {
                        node.style[property] = "default";
                    }
                    changed += 1;
                }
                continue;
            }
            if (value === "none" || value === "contain" || value === "all") {
                if (node.style.setProperty) {
                    node.style.setProperty(cssProperty, desiredSelection, "important");
                }
                else {
                    node.style[property] = desiredSelection;
                }
                changed += 1;
            }
        }
        if ((classification.kind === "safe-content" || classification.kind === "neutral") && String(node.style.pointerEvents || "").toLowerCase() === "none") {
            if (node.style.setProperty) {
                node.style.setProperty("pointer-events", "auto", "important");
            }
            else {
                node.style.pointerEvents = "auto";
            }
            changed += 1;
        }
        if (changed > 0) {
            state.styleRecoveryCount += changed;
            updateDebugHook();
        }
        return changed;
    }
    function pathHasInlineBlocker(path, eventType) {
        const property = `on${eventType}`;
        return path.some((node) => {
            if (!isElementNode(node)) {
                return false;
            }
            if (typeof node[property] === "function") {
                return true;
            }
            if (typeof node.getAttribute === "function" && node.getAttribute(property) !== null) {
                return true;
            }
            return false;
        });
    }
    function neutralizeRootBlockers() {
        let cleared = 0;
        for (const node of [documentRef, documentRef?.documentElement, documentRef?.body]) {
            if (!node) {
                continue;
            }
            cleared += clearInlineProps(node, INLINE_BLOCKER_PROPS);
            cleared += clearInlineAttributes(node, INLINE_BLOCKER_ATTRS);
            if (profile.clearOptionalInlineHandlers) {
                cleared += clearInlineProps(node, OPTIONAL_INLINE_PROPS);
                cleared += clearInlineAttributes(node, INLINE_OPTIONAL_ATTRS);
            }
        }
        if (cleared > 0) {
            state.inlineCleanupCount += cleared;
            updateDebugHook();
        }
        return cleared;
    }
    function neutralizeInlineBlockers(root = documentRef?.documentElement) {
        if (!root) {
            return 0;
        }
        const stack = [root];
        let cleared = 0;
        while (stack.length) {
            const node = stack.pop();
            if (!isElementNode(node)) {
                continue;
            }
            const alreadyProcessed = processedNodes.has(node);
            if (!alreadyProcessed) {
                processedNodes.add(node);
                state.processedNodeCount += 1;
                const classification = classifyTarget(node);
                if (isWithinEditableContext(node)) {
                    continue;
                }
                if (classification.kind === "safe-content") {
                    cleared += clearInlineProps(node, INLINE_BLOCKER_PROPS);
                    cleared += clearInlineAttributes(node, INLINE_BLOCKER_ATTRS);
                    if (profile.clearOptionalInlineHandlers) {
                        cleared += clearInlineProps(node, OPTIONAL_INLINE_PROPS);
                        cleared += clearInlineAttributes(node, INLINE_OPTIONAL_ATTRS);
                    }
                }
                else if (profile.broadenNeutralCleanup && classification.kind === "neutral") {
                    cleared += clearInlineProps(node, INLINE_BLOCKER_PROPS);
                    cleared += clearInlineAttributes(node, INLINE_BLOCKER_ATTRS);
                }
                if (classification.kind === "safe-content"
                    || (profile.broadenNeutralCleanup && classification.kind === "neutral")) {
                    recoverInlineStyles(node, classification);
                }
            }
            const children = node.children || [];
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push(children[index]);
            }
        }
        if (cleared > 0) {
            state.inlineCleanupCount += cleared;
            updateDebugHook();
        }
        return cleared;
    }
    function flushMutationBatch() {
        flushQueued = false;
        if (queuedNodes.size === 0) {
            return 0;
        }
        const batch = Array.from(queuedNodes);
        queuedNodes.clear();
        let cleared = 0;
        for (const node of batch) {
            cleared += neutralizeInlineBlockers(node);
        }
        state.mutationBatchCount += 1;
        updateDebugHook();
        return cleared;
    }
    function queueNodeForProcessing(node) {
        if (!node || queuedNodes.has(node)) {
            return;
        }
        queuedNodes.add(node);
        if (flushQueued) {
            return;
        }
        flushQueued = true;
        queueMicrotaskRef(() => flushMutationBatch());
    }
    function monitorDomChanges() {
        if (!MutationObserverRef || observer || !documentRef?.documentElement) {
            return observer;
        }
        observer = new MutationObserverRef((records = []) => {
            for (const record of records) {
                if (record?.target) {
                    queueNodeForProcessing(record.target);
                }
                const addedNodes = Array.isArray(record?.addedNodes) ? record.addedNodes : Array.from(record?.addedNodes || []);
                for (const node of addedNodes) {
                    if (isElementNode(node)) {
                        queueNodeForProcessing(node);
                    }
                }
            }
        });
        observer.observe(documentRef.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style"],
        });
        state.observerActive = true;
        return observer;
    }
    function detectAndMitigateOverlay(event) {
        const x = Number(event?.clientX);
        const y = Number(event?.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return false;
        }
        const elements = getElementsFromPoint(documentRef, x, y);
        if (elements.length < 2) {
            return false;
        }
        const top = elements[0];
        const underneath = elements.find((element, index) => {
            if (index === 0) {
                return false;
            }
            const classification = classifyTarget(element);
            return classification.kind === "safe-content";
        });
        if (!underneath || !isSuspiciousOverlay(top, documentRef, windowRef) || overlayMitigated.has(top)) {
            return false;
        }
        if (shouldSkipOverlayMitigation(top, documentRef, windowRef)) {
            return false;
        }
        overlayMitigated.add(top);
        if (typeof top.setAttribute === "function") {
            top.setAttribute(OVERLAY_ATTR, "off");
        }
        if (top.style?.setProperty) {
            top.style.setProperty("pointer-events", "none", "important");
        }
        else if (top.style) {
            top.style.pointerEvents = "none";
        }
        state.overlayMitigationCount += 1;
        updateDebugHook();
        return true;
    }
    function shouldPreemptEvent(event) {
        const target = firstElementFromPath(event);
        const path = getElementPath(event);
        if (path.some((node) => isWithinEditableContext(node)) || isWithinEditableContext(target)) {
            return false;
        }
        const classification = classifyEventPath(path);
        const type = String(event?.type || "");
        const inlineBlocked = pathHasInlineBlocker(path, type);
        if (type === "keydown" || type === "keyup") {
            if (!config.restoreClipboard || !isShortcutKey(event) || !classification.allowShortcutGuard) {
                return false;
            }
            const key = String(event?.key || "").toLowerCase();
            return true;
        }
        if (type === "copy" || type === "cut") {
            return config.restoreClipboard && classification.allowClipboardGuard;
        }
        if (type === "paste") {
            return config.restoreClipboard && classification.allowPasteGuard;
        }
        if (type === "contextmenu") {
            return config.restoreContextMenu && (classification.allowContextMenuGuard || inlineBlocked);
        }
        if (type === "selectstart") {
            return config.restoreSelection && (classification.allowSelectionGuard || inlineBlocked);
        }
        if (type === "dragstart") {
            return config.restoreSelection && classification.kind === "safe-content";
        }
        if (type === "mousedown" || type === "mouseup" || type === "auxclick") {
            return config.restorePassiveClicks && (classification.kind === "safe-content" || inlineBlocked);
        }
        if (type === "click") {
            return config.restorePassiveClicks && inlineBlocked && classification.kind === "safe-content";
        }
        return Boolean(target) && false;
    }
    function createGuard(type) {
        return function guard(event) {
            if (type === "click" || type === "contextmenu" || type === "mousedown" || type === "mouseup" || type === "auxclick" || type === "selectstart") {
                detectAndMitigateOverlay(event);
            }
            if (!shouldPreemptEvent(event)) {
                return;
            }
            callStop(event);
            for (const node of getEventPath(event)) {
                if (isElementNode(node)) {
                    queueNodeForProcessing(node);
                }
            }
        };
    }
    function installEventGuards() {
        if (state.guardInstallCount > 0) {
            return;
        }
        const events = ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart", "keydown", "mousedown", "click"];
        if (profile.guardMouseUp) {
            events.push("mouseup");
        }
        if (profile.guardAuxClick) {
            events.push("auxclick");
        }
        if (profile.guardKeyUp) {
            events.push("keyup");
        }
        for (const type of events) {
            addListener(documentRef, type, createGuard(type), true);
        }
        state.guardInstallCount = 1;
        updateDebugHook();
    }
    function handleRouteChange() {
        const nextUrl = String(windowRef?.location?.href || "");
        if (nextUrl === currentUrl && nextUrl !== "") {
            installStyleOverrides();
            neutralizeRootBlockers();
            queueNodeForProcessing(documentRef?.documentElement || documentRef?.body || null);
            return;
        }
        currentUrl = nextUrl;
        state.routeChangeCount += 1;
        installStyleOverrides();
        neutralizeRootBlockers();
        queueNodeForProcessing(documentRef?.documentElement || documentRef?.body || null);
        updateDebugHook();
    }
    function routeChangeHooks() {
        if (!windowRef?.history || historyCleanup) {
            return historyCleanup;
        }
        const historyRef = windowRef.history;
        const originalPushState = historyRef.pushState?.bind(historyRef);
        const originalReplaceState = historyRef.replaceState?.bind(historyRef);
        if (!historyRef[HISTORY_PATCHED]) {
            if (originalPushState) {
                historyRef.pushState = function patchedPushState(...args) {
                    const result = originalPushState(...args);
                    handleRouteChange();
                    return result;
                };
            }
            if (originalReplaceState) {
                historyRef.replaceState = function patchedReplaceState(...args) {
                    const result = originalReplaceState(...args);
                    handleRouteChange();
                    return result;
                };
            }
            historyRef[HISTORY_PATCHED] = true;
        }
        addListener(windowRef, "popstate", handleRouteChange, true);
        addListener(windowRef, "hashchange", handleRouteChange, true);
        addListener(windowRef, "pageshow", handleRouteChange, true);
        historyCleanup = () => {
            if (originalPushState) {
                historyRef.pushState = originalPushState;
            }
            if (originalReplaceState) {
                historyRef.replaceState = originalReplaceState;
            }
            delete historyRef[HISTORY_PATCHED];
        };
        cleanupHandlers.push(historyCleanup);
        return historyCleanup;
    }
    function bootstrap() {
        if (!config.enabled) {
            return getState();
        }
        if (state.enabled) {
            installStyleOverrides();
            return getState();
        }
        state.enabled = true;
        state.bootstrapCount += 1;
        installStyleOverrides();
        installEventGuards();
        neutralizeRootBlockers();
        neutralizeInlineBlockers(documentRef?.documentElement || documentRef?.body || null);
        monitorDomChanges();
        routeChangeHooks();
        updateDebugHook();
        return getState();
    }
    function destroy() {
        while (listeners.length) {
            const remove = listeners.pop();
            remove?.();
        }
        while (cleanupHandlers.length) {
            const cleanup = cleanupHandlers.pop();
            cleanup?.();
        }
        observer?.disconnect?.();
        observer = null;
        queuedNodes.clear();
        flushQueued = false;
        const styleNode = documentRef?.getElementById?.(STYLE_ID);
        styleNode?.remove?.();
        state.enabled = false;
        state.observerActive = false;
        if (debug && windowRef && Object.prototype.hasOwnProperty.call(windowRef, DEBUG_KEY)) {
            delete windowRef[DEBUG_KEY];
        }
    }
    function getState() {
        return {
            ...state,
            mode: config.mode,
            queuedNodeCount: queuedNodes.size,
            styleInstalled: Boolean(documentRef?.getElementById?.(STYLE_ID)),
        };
    }
    return {
        bootstrap,
        destroy,
        getState,
        classifyTarget,
        installStyleOverrides,
        installEventGuards,
        neutralizeInlineBlockers,
        monitorDomChanges,
        detectAndMitigateOverlay,
        routeChangeHooks,
        flushMutationBatch,
        neutralizeRootBlockers,
    };
}
