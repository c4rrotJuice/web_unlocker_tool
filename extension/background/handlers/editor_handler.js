import { createNotImplementedResult } from "../../shared/types/messages.js";
export function createEditorHandler() {
    return {
        requestWorkInEditor(request) {
            return createNotImplementedResult(request.type, request.requestId, {
                domain: "editor",
            });
        },
    };
}
