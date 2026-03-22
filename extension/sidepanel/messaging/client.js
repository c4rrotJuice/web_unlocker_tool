// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createRuntimeClient, SURFACE_NAMES } from "../../shared/utils/runtime_client.js";
export function createSidepanelClient(chromeApi = globalThis.chrome) {
    return createRuntimeClient(chromeApi, SURFACE_NAMES.SIDEPANEL);
}
