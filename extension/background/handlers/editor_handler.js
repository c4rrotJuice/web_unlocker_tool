import { createWorkInEditorApi } from "../api/work_in_editor_api.js";
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { normalizeWorkInEditorRequest } from "../../shared/types/work_in_editor.js";
import { validateWorkInEditorResponseData } from "../../shared/contracts/validators.js";

export function createEditorHandler({ workInEditorApi, apiClient, chromeApi } = {}) {
  const client = workInEditorApi || createWorkInEditorApi(apiClient);
  if (!client?.workInEditor) {
    throw new Error("createEditorHandler requires a workInEditorApi or apiClient.");
  }
  if (!chromeApi) {
    throw new Error("createEditorHandler requires a chromeApi.");
  }

  async function openEditorUrl(editorUrl) {
    if (!chromeApi.tabs?.create) {
      return createErrorResult(ERROR_CODES.NOT_IMPLEMENTED, "Tab creation is unavailable.");
    }
    await chromeApi.tabs.create({ url: editorUrl, active: true });
    return createOkResult({ destination: "editor", url: editorUrl });
  }

  async function workInEditor(payload = {}, sender = {}) {
    const normalizedRequest = normalizeWorkInEditorRequest(payload);
    if (!normalizedRequest.ok) {
      return normalizedRequest;
    }

    const apiResult = await client.workInEditor(normalizedRequest.data);
    if (!apiResult || apiResult.ok === false) {
      return apiResult || createErrorResult(ERROR_CODES.NETWORK_ERROR, "Work-in-editor request failed.");
    }

    const validatedResponse = validateWorkInEditorResponseData(apiResult.data || {});
    if (!validatedResponse.ok) {
      return validatedResponse;
    }

    const opened = await openEditorUrl(validatedResponse.data.editor_url);
    if (!opened.ok) {
      return opened;
    }

    return createOkResult(validatedResponse.data, {
      opened: true,
      destination: "editor",
      sender_tab_id: sender?.tab?.id ?? null,
    });
  }

  return {
    workInEditor,
  };
}
