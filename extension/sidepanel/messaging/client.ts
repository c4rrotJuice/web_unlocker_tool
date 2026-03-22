import { createRuntimeClient, SURFACE_NAMES } from "../../shared/utils/runtime_client.ts";

export function createSidepanelClient(chromeApi = globalThis.chrome) {
  return createRuntimeClient(chromeApi, SURFACE_NAMES.SIDEPANEL);
}
