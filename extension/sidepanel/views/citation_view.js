import { createCitationsListView, createStatusView } from "../components/index.js";
import { renderCitationModal } from "../app/citation_modal.js";

export function renderCitationView(root, snapshot = {}, options = {}) {
  if (!root) {
    return { mounted: false };
  }
  const documentRef = options.documentRef || globalThis.document;
  const wrapper = documentRef.createElement("section");
  wrapper.style.display = "grid";
  wrapper.style.gap = "12px";

  const listView = createCitationsListView({
    documentRef,
    citations: snapshot.recent_citations || [],
    selectedCitationId: snapshot.expanded_citation_id || null,
    lockedStyles: snapshot.locked_styles || [],
    actionAvailability: snapshot.action_availability || {},
    onExpand: options.onExpandCitation,
    onCopy: options.onCopyCitation,
    onSave: options.onSaveCitation,
    onWorkInEditor: options.onWorkInEditorCitation,
  });

  const statusView = createStatusView({
    documentRef,
    title: "Citations",
    message: "Recent citations are loaded from backend-confirmed data.",
  });

  const detailRoot = documentRef.createElement("section");
  detailRoot.setAttribute("data-citation-detail", "true");

  function render(nextSnapshot = snapshot) {
    listView.render(nextSnapshot.recent_citations || [], nextSnapshot.expanded_citation_id || null);
    detailRoot.innerHTML = "";
    if (nextSnapshot.expanded_citation_id) {
      const citation = (nextSnapshot.recent_citations || []).find((item) => item.id === nextSnapshot.expanded_citation_id) || null;
      if (citation) {
        renderCitationModal(detailRoot, {
          status: "ready",
          visible: true,
          citation,
          render_bundle: citation.renders ? { renders: citation.renders } : null,
          selected_style: citation.style || "apa",
          selected_format: citation.format || "bibliography",
          locked_styles: nextSnapshot.locked_styles || [],
          action_availability: nextSnapshot.action_availability || {},
          loading: false,
          error: null,
          saved: false,
          saved_at: null,
        }, {
          documentRef,
          chromeApi: options.chromeApi,
          navigatorRef: options.navigatorRef,
          onRequestRender: options.onRequestRenderCitation,
          onSave: options.onSaveCitation,
          onDismiss: options.onDismissCitation,
        });
      }
    }
    wrapper.innerHTML = "";
    wrapper.appendChild(statusView.root);
    wrapper.appendChild(listView.root);
    if (detailRoot.childNodes?.length || detailRoot.children?.length) {
      wrapper.appendChild(detailRoot);
    }
  }

  render(snapshot);
  root.innerHTML = "";
  root.appendChild(wrapper);

  return {
    mounted: true,
    render,
  };
}
