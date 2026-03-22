import { ENDPOINTS } from "../../shared/constants/endpoints.ts";
import { ERROR_CODES } from "../../shared/types/messages.ts";
import { validateWorkInEditorLaunchResponse } from "../../shared/contracts/validators.ts";

export function createWorkInEditorApi(apiClient) {
  if (!apiClient?.request) {
    throw new Error("Work-in-editor API requires a client with request().");
  }

  return {
    requestWorkInEditor(payload) {
      return apiClient.request(ENDPOINTS.WORK_IN_EDITOR, {
        method: "POST",
        auth: true,
        body: payload,
        fallbackCode: ERROR_CODES.INVALID_PAYLOAD,
        label: "Work-in-editor response",
      }).then((result) => {
        if (result?.ok === false) {
          return result;
        }
        return validateWorkInEditorLaunchResponse(result.data || {});
      });
    },
  };
}
