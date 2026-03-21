import { ENDPOINTS } from "../../shared/constants/endpoints.js";
import { ERROR_CODES } from "../../shared/types/messages.js";
import { CAPTURE_KIND } from "../../shared/types/capture.js";
import { validateCaptureEntityResponse } from "../../shared/contracts/validators.js";

export function createCaptureApi(apiClient) {
  if (!apiClient?.request) {
    throw new Error("Capture API requires a client with request().");
  }

  return {
    createCitation(payload) {
      return apiClient.request(ENDPOINTS.CAPTURE_CITATION, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        responseValidator: (data) => validateCaptureEntityResponse(data, CAPTURE_KIND.CITATION),
        responseLabel: "Citation capture response",
      });
    },
    createQuote(payload) {
      return apiClient.request(ENDPOINTS.CAPTURE_QUOTE, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        responseValidator: (data) => validateCaptureEntityResponse(data, CAPTURE_KIND.QUOTE),
        responseLabel: "Quote capture response",
      });
    },
    createNote(payload) {
      return apiClient.request(ENDPOINTS.CAPTURE_NOTE, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        responseValidator: (data) => validateCaptureEntityResponse(data, CAPTURE_KIND.NOTE),
        responseLabel: "Note capture response",
      });
    },
  };
}
