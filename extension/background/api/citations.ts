import { ENDPOINTS } from "../../shared/constants/endpoints.ts";
import { ERROR_CODES } from "../../shared/types/messages.ts";
import { validateCitationPreviewResponse, validateCitationRenderBundle } from "../../shared/contracts/validators.ts";

export function createCitationApi(apiClient) {
  if (!apiClient?.request) {
    throw new Error("Citation API requires a client with request().");
  }

  return {
    previewCitation(payload) {
      return apiClient.request(ENDPOINTS.CITATION_PREVIEW, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        label: "Citation preview response",
      }).then((result) => {
        if (result?.ok === false) {
          return result;
        }
        return validateCitationPreviewResponse(result.data || {});
      });
    },
    renderCitation(payload) {
      return apiClient.request(ENDPOINTS.CITATION_RENDER, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        label: "Citation render response",
      }).then((result) => {
        if (result?.ok === false) {
          return result;
        }
        return validateCitationRenderBundle(result.data || {});
      });
    },
    saveCitation(payload) {
      return apiClient.request(ENDPOINTS.CITATIONS, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        label: "Citation save response",
      });
    },
  };
}
