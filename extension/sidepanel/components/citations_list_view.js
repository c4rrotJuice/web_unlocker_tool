// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { getCitationPreviewText, normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.js";
import { createEmptyStateCard } from "./empty_state_card.js";
import { createHoverPreview } from "./hover_preview.js";
export function createCitationsListView(options = {}) {
    const { documentRef = globalThis.document, citations = [], selectedCitationId = null, onExpand, onCopy, } = options;
    const root = documentRef.createElement("section");
    root.setAttribute("data-citations-list-view", "true");
    root.style.display = "grid";
    root.style.gap = "12px";
    const preview = createHoverPreview({
        documentRef,
        label: "Citation preview",
        emptyText: "Hover or focus a citation to preview details.",
    });
    const list = documentRef.createElement("div");
    list.style.display = "grid";
    list.style.gap = "10px";
    function render(nextCitations = citations, expandedId = selectedCitationId) {
        list.innerHTML = "";
        if (!nextCitations.length) {
            list.appendChild(createEmptyStateCard({
                documentRef,
                title: "No recent citations",
                body: "Recent citations will appear here when backend data is available.",
            }).root);
            preview.clear();
            return;
        }
        for (const citation of nextCitations) {
            const row = documentRef.createElement("section");
            row.setAttribute("data-citation-id", citation.id || "");
            row.style.display = "grid";
            row.style.gap = "8px";
            row.style.padding = "12px";
            row.style.borderRadius = "16px";
            row.style.border = citation.id === expandedId ? "1px solid #0f172a" : "1px solid rgba(148, 163, 184, 0.18)";
            row.style.background = "#ffffff";
            const title = documentRef.createElement("div");
            title.textContent = citation.source?.title || citation.excerpt || "Citation";
            title.style.fontWeight = "700";
            title.style.color = "#0f172a";
            title.style.overflowWrap = "anywhere";
            const meta = documentRef.createElement("div");
            meta.textContent = [citation.source?.hostname, citation.created_at].filter(Boolean).join(" • ");
            meta.style.fontSize = "12px";
            meta.style.color = "#64748b";
            const previewText = getCitationPreviewText(citation, normalizeCitationStyle(citation.style || "apa"), normalizeCitationFormat(citation.format || "bibliography")) || citation.quote_text || citation.excerpt || "No citation text available.";
            const summary = documentRef.createElement("div");
            summary.textContent = citation.id === expandedId ? previewText : previewText.slice(0, 140);
            summary.style.whiteSpace = "pre-wrap";
            summary.style.wordBreak = "break-word";
            summary.style.overflowWrap = "anywhere";
            summary.style.color = "#334155";
            const actions = documentRef.createElement("div");
            actions.style.display = "flex";
            actions.style.gap = "8px";
            const expand = documentRef.createElement("button");
            expand.type = "button";
            expand.textContent = citation.id === expandedId ? "Collapse" : "Expand";
            expand.addEventListener("click", (event) => {
                event.preventDefault?.();
                onExpand?.(citation);
            });
            const copy = documentRef.createElement("button");
            copy.type = "button";
            copy.textContent = "Copy";
            copy.addEventListener("click", (event) => {
                event.preventDefault?.();
                onCopy?.({ citation, text: previewText });
            });
            for (const button of [expand, copy]) {
                button.style.padding = "7px 10px";
                button.style.borderRadius = "999px";
                button.style.border = "1px solid rgba(148, 163, 184, 0.22)";
                button.style.background = "#f8fafc";
                button.style.color = "#0f172a";
            }
            const updatePreview = () => {
                preview.render({
                    label: "Citation preview",
                    meta: [citation.source?.title || "Citation", citation.source?.hostname, citation.style, citation.format].filter(Boolean).join(" • "),
                    body: previewText,
                });
            };
            row.addEventListener("mouseenter", updatePreview);
            row.addEventListener("focusin", updatePreview);
            row.appendChild(title);
            row.appendChild(meta);
            row.appendChild(summary);
            actions.appendChild(expand);
            actions.appendChild(copy);
            row.appendChild(actions);
            list.appendChild(row);
        }
    }
    render(citations, selectedCitationId);
    root.appendChild(preview.root);
    root.appendChild(list);
    return { root, render };
}
