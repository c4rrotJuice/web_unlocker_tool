import { MESSAGE_NAMES } from "../shared/constants/message_names.js";
import { STORAGE_KEYS } from "../shared/constants/storage_keys.js";
import { createContentToastController } from "./ui/toast.js";
import { probePageContext } from "./dom/context_probe.js";
import { createPageUnlockEngine } from "./page/unlock_engine.js";
import { createSelectionRuntime } from "./selection/index.js";

export function createContentRuntime() {
  const documentRef = globalThis.document;
  const windowRef = globalThis.window;
  const toastController = createContentToastController({
    documentRef,
    windowRef,
    enabled: false,
  });
  const engine = createPageUnlockEngine({
    documentRef,
    windowRef,
    MutationObserverRef: globalThis.MutationObserver,
    setTimeoutRef: globalThis.setTimeout?.bind(globalThis),
    clearTimeoutRef: globalThis.clearTimeout?.bind(globalThis),
    toastController,
  });
  const selection = createSelectionRuntime({
    documentRef,
    windowRef,
    MutationObserverRef: globalThis.MutationObserver,
    setTimeoutRef: globalThis.setTimeout?.bind(globalThis),
    clearTimeoutRef: globalThis.clearTimeout?.bind(globalThis),
    navigatorRef: globalThis.navigator,
    chromeApi: globalThis.chrome,
  });
  return {
    kind: "content-runtime",
    messageNames: MESSAGE_NAMES,
    storageKeys: STORAGE_KEYS,
    utilities: {
      probePageContext: () => probePageContext({ documentRef, windowRef }),
    },
    engine,
    selection,
    bootstrap() {
      const unlockState = engine.bootstrap();
      const selectionState = selection.bootstrap();
      return { unlockState, selectionState };
    },
    destroy() {
      selection.destroy();
      return engine.destroy();
    },
    getState() {
      return {
        unlock: engine.getState(),
        selection: selection.getState(),
      };
    },
  };
}

export function bootstrapContentRuntime() {
  return createContentRuntime().bootstrap();
}

if (typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined") {
  const singletonKey = "__WRITIOR_CONTENT_RUNTIME__";
  const windowRef = globalThis.window;
  if (!windowRef[singletonKey]) {
    windowRef[singletonKey] = createContentRuntime();
    void windowRef[singletonKey].bootstrap();
  }
}
