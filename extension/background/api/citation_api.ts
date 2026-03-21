import { ENDPOINTS } from "../../shared/constants/endpoints.ts";
import { ERROR_CODES } from "../../shared/types/messages.ts";
import { validateCitationRenderBundlePayload } from "../../shared/contracts/validators.ts";

export function createCitationApi(apiClient) {
  if (!apiClient?.request) {
    throw new Error("Citation API requires a client with request().");
  }

  return {
    renderCitation(payload) {
      return apiClient.request(ENDPOINTS.CITATION_RENDER, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        responseValidator: validateCitationRenderBundlePayload,
        responseLabel: "Citation render response",
      });
    },
  };
}
