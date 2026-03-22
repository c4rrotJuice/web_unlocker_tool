import { createBackgroundRuntime } from "./runtime/bootstrap.ts";

if (globalThis.chrome?.runtime?.onMessage?.addListener && globalThis.chrome?.storage?.local) {
  const runtime = createBackgroundRuntime();
  runtime.registerLifecycleHooks();
  void runtime.bootstrap();
}

export { createBackgroundRuntime };
