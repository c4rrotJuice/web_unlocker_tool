import { createErrorResult, ERROR_CODES } from "../types/messages.ts";
import { validateInternalMessageResponse } from "../contracts/validators.ts";

export function sendRuntimeMessage(chromeApi, message) {
  const runtime = chromeApi?.runtime;
  if (!runtime?.sendMessage) {
    return Promise.resolve(createErrorResult(ERROR_CODES.NETWORK_ERROR, "Runtime messaging is unavailable."));
  }
  return new Promise((resolve) => {
    runtime.sendMessage(message, (response) => {
      const lastError = runtime.lastError;
      if (lastError) {
        resolve(createErrorResult(ERROR_CODES.NETWORK_ERROR, lastError.message || "Runtime messaging failed."));
        return;
      }
      const validationError = validateInternalMessageResponse(response, "Runtime message response");
      if (validationError) {
        resolve(validationError);
        return;
      }
      resolve(response);
    });
  });
}
