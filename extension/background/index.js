// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createBackgroundRuntime } from "./runtime/bootstrap.js";
import { createLogger } from "../shared/utils/logger.js";
const logger = createLogger("background-entry");
if (globalThis.chrome?.runtime?.onMessage?.addListener && globalThis.chrome?.storage?.local) {
    try {
        const runtime = createBackgroundRuntime();
        runtime.registerLifecycleHooks();
        void runtime.bootstrap().catch((error) => {
            logger.warn("background bootstrap failed", { message: error?.message || String(error) });
        });
    }
    catch (error) {
        logger.warn("background initialization failed", { message: error?.message || String(error) });
    }
}
export { createBackgroundRuntime };
