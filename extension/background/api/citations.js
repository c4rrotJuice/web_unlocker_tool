import { ENDPOINTS } from "../../shared/constants/endpoints.js";
import { ERROR_CODES } from "../../shared/types/messages.js";
import { validateCitationRenderBundle } from "../../shared/contracts/validators.js";
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
                label: "Citation render response",
            }).then((result) => {
                if (result?.ok === false) {
                    return result;
                }
                return validateCitationRenderBundle(result.data || {});
            });
        },
    };
}
