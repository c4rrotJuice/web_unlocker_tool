// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createLogger } from "../shared/utils/logger.js";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.js";
import { renderSidepanelShell } from "./app/index.js";
const logger = createLogger("sidepanel");
export function renderSidepanel(root, options = {}) {
    const typedOptions = options;
    return renderSidepanelShell(root, {
        ...typedOptions,
        client: typedOptions.client
            || typedOptions.runtimeClient
            || createRuntimeClient(typedOptions.chromeApi || globalThis.chrome, SURFACE_NAMES.SIDEPANEL),
    });
}
export function bootstrapSidepanel() {
    logger.info("sidepanel loaded");
    const root = document.getElementById("app");
    if (!root) {
        return null;
    }
    return renderSidepanel(root);
}
if (typeof globalThis.document !== "undefined") {
    bootstrapSidepanel();
}
