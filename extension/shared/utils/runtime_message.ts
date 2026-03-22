import { createErrorResult, ERROR_CODES } from "../types/messages.ts";
import { validateMessageEnvelope, validateMessageResult } from "../contracts/validators.ts";

function mapRuntimeFailure(messageText: string, requestId) {
  const normalized = String(messageText || "").trim();
  if (/Extension context invalidated/i.test(normalized)) {
    return createErrorResult(
      ERROR_CODES.INVALID_CONTEXT,
      "Extension context invalidated. Reload the page and try again.",
      requestId,
    );
  }
  return createErrorResult(
    ERROR_CODES.UNEXPECTED_ERROR,
    normalized || "Runtime message failed.",
    requestId,
  );
}

export function sendRuntimeMessage(chromeApi, message) {
  const envelopeError = validateMessageEnvelope(message);
  if (envelopeError) {
    return Promise.resolve(envelopeError);
  }

  if (!chromeApi?.runtime?.sendMessage) {
    return Promise.resolve(
      createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "chrome.runtime.sendMessage is unavailable.", message.requestId),
    );
  }

  return new Promise((resolve) => {
    try {
      chromeApi.runtime.sendMessage(message, (response) => {
        if (chromeApi.runtime?.lastError) {
          resolve(mapRuntimeFailure(chromeApi.runtime.lastError.message, message.requestId));
          return;
        }

        if (!response) {
          resolve(createErrorResult(
            ERROR_CODES.UNEXPECTED_ERROR,
            "No response received from background.",
            message.requestId,
          ));
          return;
        }

        const resultError = validateMessageResult(response, message.requestId);
        if (resultError) {
          resolve(resultError);
          return;
        }

        resolve(response);
      });
    } catch (error) {
      resolve(mapRuntimeFailure(error?.message, message.requestId));
    }
  });
}
