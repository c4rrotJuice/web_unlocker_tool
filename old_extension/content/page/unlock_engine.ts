import { isEditableElement, getNodeLabel, walkElementTree, setImportantStyle } from "../utils/dom_utils.ts";

const STYLE_ID = "writior-content-unlock-style";
const ROOT_ATTR = "data-writior-content-engine";
const HIDDEN_ATTR = "data-writior-soft-hidden";

function createEventGuard(allowEditable) {
  return function guard(event) {
    const target = event?.target || null;
    if (allowEditable(target)) {
      return;
    }
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    if (typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  };
}

function createKeydownGuard(allowEditable) {
  return function guard(event) {
    const target = event?.target || null;
    if (allowEditable(target)) {
      return;
    }
    const key = String(event?.key || "").toLowerCase();
    const shortcut = event?.ctrlKey || event?.metaKey;
    if (!shortcut) {
      return;
    }
    if (["c", "x", "v", "a", "s"].includes(key)) {
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
    }
  };
}

function isLikelyAdCandidate(node) {
  const label = getNodeLabel(node);
  if (!label) {
    return false;
  }
  const terms = [" ad ", " ads ", "advert", "sponsor", "promot", "cookie", "banner", "newsletter", "subscribe"];
  return terms.some((term) => label.includes(term) || label.startsWith(term.trim()) || label.endsWith(term.trim()));
}

function isOverlayLike(node, windowRef) {
  const computed = typeof windowRef?.getComputedStyle === "function" ? windowRef.getComputedStyle(node) : node?.style || {};
  const position = String(computed?.position || "").toLowerCase();
  const visibility = String(computed?.visibility || "").toLowerCase();
  const display = String(computed?.display || "").toLowerCase();
  const zIndex = Number.parseInt(String(computed?.zIndex || node?.style?.zIndex || "0"), 10) || 0;
  return (
    position === "fixed"
    || position === "sticky"
    || zIndex >= 999
    || display === "block" && visibility !== "hidden"
  );
}

export function createPageUnlockEngine({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  MutationObserverRef = globalThis.MutationObserver,
  setTimeoutRef = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutRef = globalThis.clearTimeout?.bind(globalThis),
  toastController = null,
  focusModeEnabled = true,
  adCleanupEnabled = true,
} = {}) {
  const allowEditable = (node) => isEditableElement(node);
  const listeners = [];
  const cleanupHandlers = [];
  const state = {
    bootstrapCount: 0,
    appliedCount: 0,
    mutationCount: 0,
    hiddenAdCount: 0,
    enabled: false,
    scheduled: false,
    styleInstalled: false,
  };
  let observer = null;
  let scheduleTimer = null;

  function addListener(target, type, handler, options = true) {
    if (!target?.addEventListener) {
      return;
    }
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener?.(type, handler, options));
  }

  function ensureStyleNode() {
    if (!documentRef?.head && !documentRef?.documentElement) {
      return null;
    }
    const existing = documentRef.getElementById?.(STYLE_ID) || null;
    if (existing) {
      state.styleInstalled = true;
      return existing;
    }
    const styleNode = documentRef.createElement("style");
    styleNode.id = STYLE_ID;
    styleNode.textContent = `
      html, body, body * {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      input, textarea, select, option, button, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"] {
        -webkit-user-select: auto !important;
        user-select: auto !important;
      }
      [${HIDDEN_ATTR}="true"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    (documentRef.head || documentRef.documentElement || documentRef.body).appendChild(styleNode);
    state.styleInstalled = true;
    return styleNode;
  }

  function hideCandidate(node) {
    if (!node || node.getAttribute?.(HIDDEN_ATTR) === "true") {
      return false;
    }
    setImportantStyle(node, "display", "none");
    setImportantStyle(node, "visibility", "hidden");
    if (typeof node.setAttribute === "function") {
      node.setAttribute(HIDDEN_ATTR, "true");
    }
    state.hiddenAdCount += 1;
    return true;
  }

  function cleanupAds() {
    if (!adCleanupEnabled || !documentRef?.body) {
      return 0;
    }
    let hidden = 0;
    walkElementTree(documentRef.body, (node) => {
      if (!node || node === documentRef.body || node === documentRef.documentElement) {
        return;
      }
      if (isEditableElement(node)) {
        return;
      }
      if (!isLikelyAdCandidate(node)) {
        return;
      }
      if (!isOverlayLike(node, windowRef)) {
        return;
      }
      if (hideCandidate(node)) {
        hidden += 1;
      }
    });
    return hidden;
  }

  function applyUnlocks() {
    state.appliedCount += 1;
    ensureStyleNode();
    if (focusModeEnabled && documentRef?.documentElement) {
      setImportantStyle(documentRef.documentElement, "userSelect", "text");
      setImportantStyle(documentRef.documentElement, "-webkit-user-select", "text");
    }
    const hidden = cleanupAds();
    if (hidden > 0 && toastController?.show) {
      toastController.show(hidden === 1 ? "Removed 1 distracting overlay" : `Removed ${hidden} distracting overlays`);
    }
    return { hidden };
  }

  function scheduleReapply() {
    if (state.scheduled) {
      return;
    }
    state.scheduled = true;
    scheduleTimer = setTimeoutRef?.(() => {
      state.scheduled = false;
      scheduleTimer = null;
      applyUnlocks();
    }, 75) || null;
  }

  function handleMutation() {
    state.mutationCount += 1;
    scheduleReapply();
  }

  function destroy() {
    while (listeners.length) {
      const remove = listeners.pop();
      remove?.();
    }
    cleanupHandlers.splice(0).forEach((cleanup) => cleanup());
    if (observer?.disconnect) {
      observer.disconnect();
    }
    observer = null;
    if (scheduleTimer && clearTimeoutRef) {
      clearTimeoutRef(scheduleTimer);
      scheduleTimer = null;
    }
    const styleNode = documentRef?.getElementById?.(STYLE_ID);
    styleNode?.remove?.();
    state.enabled = false;
  }

  function bootstrap() {
    if (state.enabled) {
      return getState();
    }
    state.enabled = true;
    state.bootstrapCount += 1;

    addListener(documentRef, "contextmenu", createEventGuard(allowEditable), true);
    addListener(documentRef, "copy", createEventGuard(allowEditable), true);
    addListener(documentRef, "cut", createEventGuard(allowEditable), true);
    addListener(documentRef, "paste", createEventGuard(allowEditable), true);
    addListener(documentRef, "selectstart", createEventGuard(allowEditable), true);
    addListener(documentRef, "mousedown", createEventGuard(allowEditable), true);
    addListener(documentRef, "keydown", createKeydownGuard(allowEditable), true);
    addListener(documentRef, "dragstart", createEventGuard(allowEditable), true);
    addListener(windowRef, "pageshow", () => scheduleReapply(), true);
    addListener(windowRef, "resize", () => scheduleReapply(), true);

    if (MutationObserverRef && documentRef?.documentElement) {
      observer = new MutationObserverRef(() => handleMutation());
      observer.observe(documentRef.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden", "id"],
      });
    }

    applyUnlocks();
    return getState();
  }

  function getState() {
    return {
      enabled: state.enabled,
      bootstrapCount: state.bootstrapCount,
      appliedCount: state.appliedCount,
      mutationCount: state.mutationCount,
      hiddenAdCount: state.hiddenAdCount,
      styleInstalled: state.styleInstalled,
    };
  }

  function reapplyNow() {
    return applyUnlocks();
  }

  return {
    bootstrap,
    destroy,
    getState,
    reapplyNow,
    isEditableTarget: allowEditable,
    scheduleReapply,
    inspectNode: (node) => ({
      editable: allowEditable(node),
      label: getNodeLabel(node),
    }),
  };
}
