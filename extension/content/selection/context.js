// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { buildContentCapturePayload } from "../../shared/types/capture.js";
export function buildSelectionContextPayload({ selection, page, }) {
    return {
        version: 1,
        ...buildContentCapturePayload({
            selectionText: selection?.normalized_text || selection?.text || "",
            pageTitle: page?.title || "",
            pageUrl: page?.url || "",
            pageDomain: page?.host || "",
        }),
    };
}
