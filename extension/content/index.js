import { createOverlayRoot } from "./overlay_root.js";
import { createSelectionWatcher } from "./selection_watcher.js";
import { extractPageMetadata } from "./metadata_extractor.js";
import { createCapturePill } from "./capture_pill.js";
import { createNoteComposer } from "./note_composer.js";
import { sendRuntimeMessage } from "./runtime_bridge.js";
import { createFloatingIcon } from "./floating_icon.js";
import { createCitationPreview } from "./citation_preview.js";
import { createIdempotencyKey } from "../shared/models.js";
import { MESSAGE_TYPES } from "../shared/messages.js";
import { BACKEND_BASE_URL } from "../config.js";

(() => {
  const EXT_KEY = "WRITIOR_EXTENSION";
  if (window[EXT_KEY]?.mounted) {
    return;
  }

  const lifecycle = {
    mounted: false,
    cleanupHandlers: [],
    observer: null,
    originalPushState: history.pushState,
    originalReplaceState: history.replaceState,
    handoffRequestHandler: null,
    handoffInFlight: false,
    authStorageChangeHandler: null,
    uiStorageChangeHandler: null,
  };

  const overlay = createOverlayRoot();
  const context = {
    selected_text: "",
    rect: null,
    metadata: extractPageMetadata(),
  };
  let captureUiEnabled = true;

  const noteComposer = createNoteComposer({
    overlay,
    readContext: () => ({ ...context }),
  });
  async function saveCitation(extraPayload = {}) {
    await sendRuntimeMessage(MESSAGE_TYPES.CAPTURE_CITATION, {
      url: context.metadata.canonical_url || context.metadata.url,
      metadata: context.metadata,
      excerpt: context.selected_text,
      quote: context.selected_text,
      locator: {},
      ...extraPayload,
      idempotency_key: extraPayload.idempotency_key || createIdempotencyKey("citation"),
    });
  }
  async function workInEditor(extraPayload = {}) {
    await sendRuntimeMessage(MESSAGE_TYPES.WORK_IN_EDITOR, {
      url: context.metadata.canonical_url || context.metadata.url,
      title: context.metadata.title || "",
      selected_text: context.selected_text,
      metadata: context.metadata,
      locator: {},
      ...extraPayload,
      idempotency_key: extraPayload.idempotency_key || createIdempotencyKey("editor"),
    });
  }
  const citationPreview = createCitationPreview({
    overlay,
    readContext: () => ({ ...context }),
    onSaveCitation: saveCitation,
    onWorkInEditor: workInEditor,
  });
  const floatingIcon = createFloatingIcon({ overlay });
  const capturePill = createCapturePill({
    overlay,
    readContext: () => ({ ...context }),
    openComposer: () => noteComposer.open(),
    openCitationPreview: () => citationPreview.open(),
    isEnabled: () => captureUiEnabled,
  });

  async function loadCaptureUiEnabled() {
    const payload = await chrome.storage.local.get({ capture_ui_enabled: true });
    captureUiEnabled = Boolean(payload.capture_ui_enabled);
  }

  function applyCaptureUiEnabled() {
    floatingIcon.setVisible(captureUiEnabled);
    if (!captureUiEnabled) {
      capturePill.destroy();
      citationPreview.close();
      noteComposer.close();
      return;
    }
    capturePill.render(context);
  }

  function updateSelectionContext(payload) {
    context.selected_text = payload.text;
    context.rect = payload.rect;
    context.metadata = extractPageMetadata();
    void sendRuntimeMessage(MESSAGE_TYPES.SET_LAST_SELECTION, { text: context.selected_text || "" });
  }

  const selectionWatcher = createSelectionWatcher({
    onSelectionChange(payload) {
      if (!captureUiEnabled) return;
      updateSelectionContext(payload);
      capturePill.render(context);
    },
  });

  function isCanonicalHandoffPath() {
    try {
      const baseOrigin = new URL(BACKEND_BASE_URL).origin;
      return window.location.origin === baseOrigin && window.location.pathname === "/auth/handoff";
    } catch {
      return false;
    }
  }

  function dispatchHandoffResult(detail) {
    window.dispatchEvent(
      new CustomEvent("writior:auth-handoff-result", {
        detail,
      }),
    );
  }

  function readHandoffCodeFromLocation() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      const code = (params.get("code") || "").trim();
      return code || null;
    } catch {
      return null;
    }
  }

  async function runHandoffRestore(code) {
    if (!code) {
      dispatchHandoffResult({ ok: false, error: "handoff_code_missing" });
      return;
    }
    if (lifecycle.handoffInFlight) {
      return;
    }
    lifecycle.handoffInFlight = true;
    try {
      const response = await sendRuntimeMessage(MESSAGE_TYPES.AUTH_RESTORE, { code });
      dispatchHandoffResult(response || { ok: false, error: "handoff_restore_failed" });
    } finally {
      lifecycle.handoffInFlight = false;
    }
  }

  function registerHandoffBridge() {
    if (!isCanonicalHandoffPath()) {
      return;
    }

    const handler = (event) => {
      const eventCode = (event?.detail?.code || "").trim();
      void runHandoffRestore(eventCode || readHandoffCodeFromLocation());
    };

    lifecycle.handoffRequestHandler = handler;
    window.addEventListener("writior:auth-handoff-request", handler);

    const initialCode = readHandoffCodeFromLocation();
    if (initialCode) {
      void runHandoffRestore(initialCode);
    }
  }

  function dispatchAuthStateFromSession(session) {
    const tokenKeys = ["access", "token"];
    const joinedTokenKey = tokenKeys.join("_");
    window.dispatchEvent(
      new CustomEvent("writior:auth-state-changed", {
        detail: {
          is_authenticated: Boolean(session?.[joinedTokenKey]),
          user_id: session?.user?.id || null,
          email: session?.user?.email || null,
          expires_at: session?.expires_at || null,
        },
      }),
    );
  }

  function registerAuthStateBridge() {
    const handler = (changes, areaName) => {
      if (areaName !== "local") return;
      if (!changes?.session) return;
      dispatchAuthStateFromSession(changes.session.newValue || null);
    };
    lifecycle.authStorageChangeHandler = handler;
    chrome.storage?.onChanged?.addListener?.(handler);
  }

  function cleanup() {
    if (lifecycle.handoffRequestHandler) {
      window.removeEventListener("writior:auth-handoff-request", lifecycle.handoffRequestHandler);
      lifecycle.handoffRequestHandler = null;
    }
    if (lifecycle.authStorageChangeHandler) {
      chrome.storage?.onChanged?.removeListener?.(lifecycle.authStorageChangeHandler);
      lifecycle.authStorageChangeHandler = null;
    }
    if (lifecycle.uiStorageChangeHandler) {
      chrome.storage?.onChanged?.removeListener?.(lifecycle.uiStorageChangeHandler);
      lifecycle.uiStorageChangeHandler = null;
    }
    selectionWatcher.stop();
    floatingIcon.destroy();
    capturePill.destroy();
    citationPreview.close();
    noteComposer.close();
    lifecycle.observer?.disconnect?.();
    history.pushState = lifecycle.originalPushState;
    history.replaceState = lifecycle.originalReplaceState;
    overlay.destroy();
    lifecycle.mounted = false;
  }

  function bootstrap() {
    lifecycle.mounted = true;
    registerHandoffBridge();
    registerAuthStateBridge();
    void loadCaptureUiEnabled().then(() => applyCaptureUiEnabled());
    void sendRuntimeMessage(MESSAGE_TYPES.SET_LAST_SELECTION, { text: "" });
    lifecycle.uiStorageChangeHandler = (changes, areaName) => {
      if (areaName !== "local") return;
      if (!changes?.capture_ui_enabled) return;
      captureUiEnabled = Boolean(changes.capture_ui_enabled.newValue);
      applyCaptureUiEnabled();
    };
    chrome.storage?.onChanged?.addListener?.(lifecycle.uiStorageChangeHandler);
    lifecycle.cleanupHandlers = [cleanup];
  }

  bootstrap();

  window[EXT_KEY] = {
    mounted: true,
    bootstrap,
    cleanup,
  };

  const handleRouteChange = () => {
    context.selected_text = "";
    context.rect = null;
    context.metadata = extractPageMetadata();
    capturePill.destroy();
    citationPreview.close();
    noteComposer.close();
    void sendRuntimeMessage(MESSAGE_TYPES.SET_LAST_SELECTION, { text: "" });
  };
  history.pushState = function pushState(...args) {
    lifecycle.originalPushState.apply(history, args);
    handleRouteChange();
  };
  history.replaceState = function replaceState(...args) {
    lifecycle.originalReplaceState.apply(history, args);
    handleRouteChange();
  };
  lifecycle.observer = new MutationObserver(() => {
    if (!document.body.contains(overlay.host)) {
      document.body.appendChild(overlay.host);
    }
  });
  lifecycle.observer.observe(document.documentElement, { childList: true, subtree: true });
})();
