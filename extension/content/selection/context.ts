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
      canonicalUrl: page?.canonical_url || "",
      description: page?.description || "",
      language: page?.language || "",
      siteName: page?.site_name || "",
      titleCandidates: page?.title_candidates || [],
      authorCandidates: page?.author_candidates || [],
      dateCandidates: page?.date_candidates || [],
      publisherCandidates: page?.publisher_candidates || [],
      containerCandidates: page?.container_candidates || [],
      sourceTypeCandidates: page?.source_type_candidates || [],
      identifiers: page?.identifiers || {},
      extractionEvidence: page?.extraction_evidence || {},
      rawMetadata: page?.raw_metadata || {},
    }),
  };
}
