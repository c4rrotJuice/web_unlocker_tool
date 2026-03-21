import { ENDPOINTS } from "../../shared/constants/endpoints.js";
import { ERROR_CODES } from "../../shared/types/messages.js";
import { validateBootstrapSnapshot } from "../../shared/contracts/validators.js";

export function createBootstrapApi(apiClient) {
  if (!apiClient?.request) {
    throw new Error("Bootstrap API requires a client with request().");
  }

  return {
    async loadBootstrap() {
      return apiClient.request(ENDPOINTS.BOOTSTRAP, {
        method: "GET",
        auth: true,
        fallbackCode: ERROR_CODES.BOOTSTRAP_FAILED,
        responseValidator: validateBootstrapSnapshot,
        responseLabel: "Bootstrap response",
      });
    },
  };
}
