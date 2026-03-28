import { createRuntimeClient } from "../shared/utils/runtime_client.ts";
import { createPageUnlockEngine } from "./unlock/engine.ts";
import { createSelectionRuntime } from "./selection/index.ts";
import { createSidepanelLauncher } from "./ui/sidepanel_launcher.ts";

const RUNTIME_KEY = "__WRITIOR_CONTENT_RUNTIME__";

function canParseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function shouldBootstrapContentRuntime(urlLike: string) {
  const parsed = canParseUrl(String(urlLike || ""));
  if (!parsed) {
    return true;
  }
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname || "/";
  const isFirstPartyEditorHost = hostname === "app.writior.com" || hostname === "localhost" || hostname === "127.0.0.1";
  const isEditorRoute = pathname === "/editor" || pathname.startsWith("/editor/");
  return !(isFirstPartyEditorHost && isEditorRoute);
}

export function createContentRuntime(options = {}) {
  const typedOptions: any = options;
  const windowRef = typedOptions.windowRef || globalThis.window;
  const documentRef = typedOptions.documentRef || globalThis.document;
  const engine = createPageUnlockEngine({
    ...typedOptions,
    windowRef,
    documentRef,
  });
  const selection = createSelectionRuntime({
    ...typedOptions,
    windowRef,
    documentRef,
  });
  const launcher = createSidepanelLauncher({
    ...typedOptions,
    windowRef,
    documentRef,
  });

  return {
    bootstrap() {
      launcher.mount();
      return {
        unlockState: engine.bootstrap(),
        selectionState: selection.bootstrap(),
        launcherState: launcher.getState(),
      };
    },
    destroy() {
      launcher.destroy();
      selection.destroy();
      engine.destroy();
    },
    getState() {
      const unlockState = engine.getState();
      return {
        ...unlockState,
        unlock: unlockState,
        selection: selection.getState(),
        launcher: launcher.getState(),
      };
    },
    runtimeClientFactory: createRuntimeClient,
    engine,
    selection,
  };
}

export function bootstrapContent(options = {}) {
  const typedOptions: any = options;
  const windowRef = typedOptions.windowRef || globalThis.window;
  const documentRef = typedOptions.documentRef || globalThis.document;
  if (!windowRef || !documentRef) {
    return null;
  }
  if (!shouldBootstrapContentRuntime(String(windowRef?.location?.href || ""))) {
    return null;
  }

  const runtimeWindow = windowRef as typeof windowRef & Record<string, unknown>;

  if (!runtimeWindow[RUNTIME_KEY]) {
    runtimeWindow[RUNTIME_KEY] = createContentRuntime({
      ...typedOptions,
      windowRef,
      documentRef,
    });
  }

  const runtime = runtimeWindow[RUNTIME_KEY];
  runtime.bootstrap();
  return runtime;
}

if (typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined") {
  bootstrapContent();
}
