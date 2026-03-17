import {
  renderCitationDetail,
  renderNoteDetail,
  renderQuoteDetail,
  renderSourceDetail,
} from "../../app_shell/renderers/details.js";
import { escapeHtml } from "../../app_shell/core/format.js";

export function renderContextRail(target, context, state, detail, handlers = {}) {
  const seed = state.seed_state;
  target.innerHTML = "";
  if (context.mode === "empty_document") {
    target.innerHTML = `<div class="editor-v2-card"><h3>Empty document</h3><p>Use the explorer or create a new document to start writing.</p></div>`;
    return;
  }
  if (context.mode === "text_selection") {
    const text = escapeHtml((handlers.selectionText?.() || "").slice(0, 220));
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Selection</h3>
        <p>${text || "Selection ready."}</p>
        <div class="editor-v2-context-actions">
          <button class="editor-v2-action" data-context-action="insert-quote">Insert quote</button>
          <button class="editor-v2-action" data-context-action="create-note">Create note</button>
        </div>
      </div>
    `;
    return;
  }
  if (context.mode === "seed_review" || context.mode === "quote_focus") {
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Seed Review</h3>
        <p>${escapeHtml(detail?.excerpt || detail?.citation?.source?.title || "Captured context is ready for writing.")}</p>
        <div class="editor-v2-context-actions">
          <button class="editor-v2-action" data-context-action="insert-seed-quote">Insert quote now</button>
          <button class="editor-v2-action" data-context-action="create-note-from-seed">Create note from quote</button>
          <button class="editor-v2-action" data-context-action="start-outline">Start outline</button>
        </div>
        <p class="editor-v2-meta">Citation: ${escapeHtml(seed?.citation_id || "none")}</p>
      </div>
    `;
    return;
  }
  if (context.mode === "citation_focus" && detail) {
    target.innerHTML = renderCitationDetail(detail);
    return;
  }
  if (context.mode === "quote_focus" && detail) {
    target.innerHTML = renderQuoteDetail(detail);
    return;
  }
  if (context.mode === "note_focus" && detail) {
    target.innerHTML = renderNoteDetail(detail);
    return;
  }
  if (context.mode === "source_focus" && detail) {
    target.innerHTML = renderSourceDetail(detail);
    return;
  }
  target.innerHTML = `<div class="editor-v2-card"><h3>Context</h3><p>Select text or focus a research item to work without modal sprawl.</p></div>`;
}
