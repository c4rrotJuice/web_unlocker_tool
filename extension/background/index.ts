import { createBackgroundRuntime } from "./runtime/bootstrap.ts";
import { createLogger } from "../shared/utils/logger.ts";

const logger = createLogger("background-entry");

if (globalThis.chrome?.runtime?.onMessage?.addListener && globalThis.chrome?.storage?.local) {
  try {
    const runtime = createBackgroundRuntime();
    runtime.registerLifecycleHooks();
    void runtime.bootstrap().catch((error) => {
      logger.warn("background bootstrap failed", { message: error?.message || String(error) });
    });
  } catch (error: any) {
    logger.warn("background initialization failed", { message: error?.message || String(error) });
  }
}

export { createBackgroundRuntime };
