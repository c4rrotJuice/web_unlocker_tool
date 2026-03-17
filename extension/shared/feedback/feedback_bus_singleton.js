import { createFeedbackRuntime } from "./toast_system.js";

let runtime = null;

export function ensureFeedbackRuntime(options = {}) {
  if (!runtime) {
    runtime = createFeedbackRuntime(options);
  }
  return runtime;
}

export function getFeedbackRuntime() {
  return runtime;
}
