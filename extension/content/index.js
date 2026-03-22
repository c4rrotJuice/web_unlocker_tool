import { createRuntimeClient } from "../shared/utils/runtime_client.js";
import { createPageUnlockEngine } from "./unlock/engine.js";
import { createSelectionRuntime } from "./selection/index.js";
const RUNTIME_KEY = "__WRITIOR_CONTENT_RUNTIME__";
export function createContentRuntime(options = {}) {
    const typedOptions = options;
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
    return {
        bootstrap() {
            return {
                unlockState: engine.bootstrap(),
                selectionState: selection.bootstrap(),
            };
        },
        destroy() {
            selection.destroy();
            engine.destroy();
        },
        getState() {
            const unlockState = engine.getState();
            return {
                ...unlockState,
                unlock: unlockState,
                selection: selection.getState(),
            };
        },
        runtimeClientFactory: createRuntimeClient,
        engine,
        selection,
    };
}
export function bootstrapContent(options = {}) {
    const typedOptions = options;
    const windowRef = typedOptions.windowRef || globalThis.window;
    const documentRef = typedOptions.documentRef || globalThis.document;
    if (!windowRef || !documentRef) {
        return null;
    }
    const runtimeWindow = windowRef;
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
