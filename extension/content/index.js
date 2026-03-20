import { createOverlayRoot } from "./overlay_root.js";
import { createSelectionWatcher } from "./selection_watcher.js";
import { extractPageMetadata } from "./metadata_extractor.js";
import { createCapturePill } from "./capture_pill.js";
import { createNoteComposer } from "./note_composer.js";
import { sendRuntimeMessage } from "./runtime_bridge.js";
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
    storageChangeHandler: null,
  };

  const overlay = createOverlayRoot();
  const context = {
    selected_text: "",
    rect: null,
    metadata: extractPageMetadata(),
  };

  const noteComposer = createNoteComposer({
    overlay,
    readContext: () => ({ ...context }),
  });
  const capturePill = createCapturePill({
    overlay,
    readContext: () => ({ ...context }),
    openComposer: () => noteComposer.open(),
  });
  const selectionWatcher = createSelectionWatcher({
    onSelectionChange(payload) {
      context.selected_text = payload.text;
      context.rect = payload.rect;
      context.metadata = extractPageMetadata();
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
    lifecycle.storageChangeHandler = handler;
    chrome.storage?.onChanged?.addListener?.(handler);
  }

  function cleanup() {
    if (lifecycle.handoffRequestHandler) {
      window.removeEventListener("writior:auth-handoff-request", lifecycle.handoffRequestHandler);
      lifecycle.handoffRequestHandler = null;
    }
    if (lifecycle.storageChangeHandler) {
      chrome.storage?.onChanged?.removeListener?.(lifecycle.storageChangeHandler);
      lifecycle.storageChangeHandler = null;
    }
    selectionWatcher.stop();
    capturePill.destroy();
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
    lifecycle.cleanupHandlers = [cleanup];
  }

  bootstrap();

  window[EXT_KEY] = {
    mounted: true,
    bootstrap,
    cleanup,
  };

  const handleRouteChange = () => {
    context.metadata = extractPageMetadata();
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
