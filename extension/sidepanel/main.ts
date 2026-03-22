import { createLogger } from "../shared/utils/logger.ts";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.ts";
import { renderSidepanelShell } from "./app/index.ts";

const logger = createLogger("sidepanel");

export function renderSidepanel(root, options = {}) {
  const typedOptions: any = options;
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
