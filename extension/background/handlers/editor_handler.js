import { createErrorResult, ERROR_CODES } from "../../shared/types/messages.js";
export function createEditorHandler(options = {}) {
    const { workInEditorApi, tabOpener } = options;
    if (!workInEditorApi?.requestWorkInEditor) {
        throw new Error("createEditorHandler requires a workInEditorApi.");
    }
    if (!tabOpener?.open) {
        throw new Error("createEditorHandler requires a tabOpener.");
    }
    return {
        async requestWorkInEditor(request) {
            const result = await workInEditorApi.requestWorkInEditor(request?.payload || {});
            if (result?.ok === false) {
                return createErrorResult(result.error?.code || ERROR_CODES.INVALID_PAYLOAD, result.error?.message || "Work-in-editor failed.", request?.requestId, result.error?.details ?? null, result.meta ?? null);
            }
            return tabOpener.open(result.data?.editor_url, request?.requestId, "editor");
        },
    };
}
