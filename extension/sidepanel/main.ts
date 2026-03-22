import { createLogger } from "../shared/utils/logger.ts";
import { renderSidepanelShell } from "./app/index.ts";

const logger = createLogger("sidepanel");

export function renderSidepanel(root, options = {}) {
  const typedOptions: any = options;
  return renderSidepanelShell(root, {
    ...typedOptions,
    client: typedOptions.client || typedOptions.runtimeClient,
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
