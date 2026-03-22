import { buildContentCapturePayload } from "../../shared/types/capture.ts";

export function buildSelectionContextPayload({
  selection,
  page,
}: {
  selection: any;
  page: any;
}) {
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
