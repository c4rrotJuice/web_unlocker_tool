import { createOverlayRoot } from "./overlay_root.js";
import { createSelectionWatcher } from "./selection_watcher.js";
import { extractPageMetadata } from "./metadata_extractor.js";
import { createCapturePill } from "./capture_pill.js";
import { createNoteComposer } from "./note_composer.js";

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

  function cleanup() {
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
