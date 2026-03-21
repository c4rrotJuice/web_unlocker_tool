import { createContentBridge } from "../messaging/bridge.js";
import { extractNormalizedSelection, selectionSignature } from "../dom/selection.js";
import { extractPageMetadata } from "../dom/page_metadata.js";
import { buildCaptureIntentPayload, buildSelectionCapturePayload } from "../serializers/capture_payload.js";
import { copyTextToClipboard } from "../utils/clipboard.js";
import { createHighlightPill } from "../ui/highlight_pill.js";
import { probePageContext } from "../dom/context_probe.js";
import { buildWorkInEditorPayload } from "../../shared/types/work_in_editor.js";
import { getActionAvailability, normalizeCapabilitySurface } from "../../shared/types/capability_surface.js";

function isSelectionVisible(snapshot) {
  return Boolean(snapshot && snapshot.text && snapshot.normalized_text.length >= 3);
}

function isCommandShortcut(event) {
  return Boolean(event?.shiftKey && (event?.ctrlKey || event?.metaKey));
}

export function createSelectionRuntime({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  MutationObserverRef = globalThis.MutationObserver,
  setTimeoutRef = globalThis.setTimeout?.bind(globalThis),
  clearTimeoutRef = globalThis.clearTimeout?.bind(globalThis),
  navigatorRef = globalThis.navigator,
  chromeApi = globalThis.chrome,
  minimumLength = 3,
} = {}) {
  const bridge = createContentBridge({ chromeApi });
  async function runAction(action, snapshot = state.currentSnapshot) {
    if (!snapshot) {
      return null;
    }
    if (action === "copy") {
      const result = await copyTextToClipboard(snapshot.selection.text, { navigatorRef, documentRef });
      if (result.ok) {
        pill.setCopySuccess();
      } else {
        pill.setCopyFailure();
      }
      return result;
    }
    const pageMetadata = snapshot.page || extractPageMetadata({ documentRef, windowRef });
    const captureIntent = buildCaptureIntentPayload({
      action,
      selectionText: snapshot.selection.normalized_text || snapshot.selection.text,
      pageTitle: pageMetadata.title,
      pageUrl: pageMetadata.url,
      pageDomain: pageMetadata.host,
      metadata: pageMetadata,
      selection: snapshot.selection,
    });
    const workIntent = buildWorkInEditorPayload({
      action: "work_in_editor",
      selectionText: snapshot.selection.normalized_text || snapshot.selection.text,
      pageTitle: pageMetadata.title,
      pageUrl: pageMetadata.url,
      pageDomain: pageMetadata.host,
      metadata: pageMetadata,
      selection: snapshot.selection,
    });
    pill.flash(action === "work_in_editor" ? "Opening editor" : "Saving");
    let result = null;
    if (action === "work_in_editor") {
      result = await bridge.workInEditor(workIntent);
    } else if (action === "cite") {
      result = await bridge.captureCitation(captureIntent);
    } else if (action === "quote") {
      result = await bridge.captureQuote(captureIntent);
    } else if (action === "note") {
      result = await bridge.captureNote(captureIntent);
    }
    if (result?.ok) {
      pill.setActionSuccess(action === "work_in_editor" ? "Editor opened" : "Saved");
    } else {
      pill.setActionFailure(result?.error?.message || "Action failed");
    }
    return result;
  }
  const pill = createHighlightPill({
    documentRef,
    windowRef,
    onAction: async (action) => {
      await runAction(action);
    },
    onDismiss: (reason) => {
      state.lastDismissReason = reason;
    },
  });

  const state = {
    enabled: false,
    currentSnapshot: null,
    currentSignature: "",
    visible: false,
    inspectCount: 0,
    renderCount: 0,
    dismissCount: 0,
    lastDismissReason: "",
    pageContext: probePageContext({ documentRef, windowRef }),
    authSnapshot: null,
    capabilitySurface: null,
  };
  const listeners = [];
  let observer = null;
  let inspectTimer = null;

  function addListener(target, type, handler, options = true) {
    if (!target?.addEventListener) {
      return;
    }
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener?.(type, handler, options));
  }

  function scheduleInspect() {
    if (inspectTimer) {
      return;
    }
    inspectTimer = setTimeoutRef?.(() => {
      inspectTimer = null;
      inspectSelection();
    }, 40) || null;
  }

  function hide(reason = "invalid") {
    if (state.visible) {
      state.dismissCount += 1;
    }
    state.visible = false;
    state.currentSnapshot = null;
    state.currentSignature = "";
    pill.hide(reason);
  }

  function show(snapshot) {
    const signature = selectionSignature(snapshot.selection);
    if (state.visible && signature === state.currentSignature) {
      pill.render({
        ...snapshot,
        actions: buildSelectionActions(),
      });
      return;
    }
    const wasVisible = state.visible;
    state.visible = true;
    state.currentSnapshot = snapshot;
    state.currentSignature = signature;
    if (!wasVisible) {
      state.renderCount += 1;
    }
    pill.render({
      ...snapshot,
      actions: buildSelectionActions(),
    });
  }

  function buildSelectionActions() {
    const surface = state.capabilitySurface;
    const hasSnapshot = Boolean(surface);
    const canWorkInEditor = hasSnapshot ? getActionAvailability(surface, "work_in_editor") : true;
    const canCite = hasSnapshot ? getActionAvailability(surface, "cite") : true;
    const canNote = hasSnapshot ? getActionAvailability(surface, "note") : true;
    const canQuote = hasSnapshot ? getActionAvailability(surface, "quote") : true;
    return [
      { key: "copy", label: "Copy", active: true, locked: false },
      { key: "work_in_editor", label: "Editor", active: canWorkInEditor, locked: !canWorkInEditor },
      { key: "cite", label: "Cite", active: canCite, locked: !canCite },
      { key: "note", label: "Note", active: canNote, locked: !canNote },
      { key: "quote", label: "Quote", active: canQuote, locked: !canQuote },
    ];
  }

  function inspectSelection() {
    state.inspectCount += 1;
    const snapshot = extractNormalizedSelection({ documentRef, minimumLength });
    if (!isSelectionVisible(snapshot)) {
      hide("selection_invalid");
      return null;
    }
    const pageMetadata = extractPageMetadata({ documentRef, windowRef });
    show({
      selection: snapshot,
      page: pageMetadata,
      ui: {
        pill: true,
        focus_mode: true,
        status: "copy_only",
      },
      bridge: {
        can_message_background: Boolean(chromeApi?.runtime?.sendMessage),
      },
      context: state.pageContext,
      payload: buildSelectionCapturePayload({
        selection: snapshot,
        page: pageMetadata,
        action: "copy",
      }),
    });
    return state.currentSnapshot;
  }

  function onDismissEvent(event) {
    if (!state.visible) {
      return;
    }
    if (pill.isInsidePill(event?.target)) {
      return;
    }
    hide("outside_click");
  }

  function onKeydown(event) {
    if (!state.visible) {
      return;
    }
    if (String(event?.key || "").toLowerCase() === "escape") {
      hide("escape");
      return;
    }
    if (!isCommandShortcut(event)) {
      return;
    }
    const key = String(event?.key || "").toLowerCase();
    const actionMap = {
      c: "copy",
      e: "work_in_editor",
      i: "cite",
      n: "note",
      q: "quote",
    };
    const action = actionMap[key];
    if (!action) {
      return;
    }
    event.preventDefault?.();
    void runAction(action);
  }

  function destroy() {
    while (listeners.length) {
      const remove = listeners.pop();
      remove?.();
    }
    if (observer?.disconnect) {
      observer.disconnect();
    }
    observer = null;
    if (inspectTimer && clearTimeoutRef) {
      clearTimeoutRef(inspectTimer);
      inspectTimer = null;
    }
    pill.destroy();
    state.enabled = false;
  }

  function bootstrap() {
    if (state.enabled) {
      return getState();
    }
    state.enabled = true;
    addListener(documentRef, "selectionchange", scheduleInspect, true);
    addListener(documentRef, "mouseup", scheduleInspect, true);
    addListener(documentRef, "keyup", scheduleInspect, true);
    addListener(documentRef, "pointerup", scheduleInspect, true);
    addListener(documentRef, "keydown", onKeydown, true);
    addListener(documentRef, "pointerdown", onDismissEvent, true);
    addListener(documentRef, "mousedown", onDismissEvent, true);
    addListener(documentRef, "click", onDismissEvent, true);
    addListener(windowRef, "scroll", scheduleInspect, true);
    addListener(windowRef, "resize", scheduleInspect, true);
    if (MutationObserverRef && documentRef?.documentElement) {
      observer = new MutationObserverRef(() => scheduleInspect());
      observer.observe(documentRef.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
    void bridge.getAuthState?.().then((response) => {
      const auth = response?.data?.auth || response?.data || null;
      state.authSnapshot = auth;
      state.capabilitySurface = normalizeCapabilitySurface({ auth });
      if (state.visible && state.currentSnapshot) {
        pill.render({
          ...state.currentSnapshot,
          actions: buildSelectionActions(),
        });
      }
    });
    inspectSelection();
    return getState();
  }

  function getState() {
    return {
      enabled: state.enabled,
      visible: state.visible,
      inspectCount: state.inspectCount,
      renderCount: state.renderCount,
      dismissCount: state.dismissCount,
      lastDismissReason: state.lastDismissReason,
      currentSignature: state.currentSignature,
      currentSnapshot: state.currentSnapshot,
      pill: pill.getState(),
    };
  }

  return {
    bootstrap,
    destroy,
    getState,
    inspectSelection,
    scheduleInspect,
    bridge,
    pill,
  };
}
