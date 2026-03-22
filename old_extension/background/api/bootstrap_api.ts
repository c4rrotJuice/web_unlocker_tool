import { ENDPOINTS } from "../../shared/constants/endpoints.ts";
import { ERROR_CODES } from "../../shared/types/messages.ts";
import { validateBootstrapSnapshot } from "../../shared/contracts/validators.ts";

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
