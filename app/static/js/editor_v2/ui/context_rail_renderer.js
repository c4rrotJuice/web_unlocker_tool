import {
  renderCitationDetail,
  renderDocumentRelationshipDetail,
  renderNoteDetail,
  renderQuoteDetail,
  renderSourceDetail,
} from "../../app_shell/renderers/details.js";
import { escapeHtml } from "../../app_shell/core/format.js";

export function renderContextRail(target, context, state, detail, handlers = {}) {
  const seed = state.seed_state;
  const sessionFailure = state.runtime_failures?.session;
  const conflictFailure = state.runtime_failures?.document_conflict;
  const transitionFailure = state.runtime_failures?.document_transition;
  const hydrateFailure = state.runtime_failures?.document_hydrate;
  const hydrateActivity = state.runtime_activity?.hydrate;
  const attached = state.attached_research || {};
  target.innerHTML = "";
  if (sessionFailure) {
    const authHref = escapeHtml(`/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Session lost</h3>
        <p>${escapeHtml(sessionFailure.message || "Your sign-in expired. Local edits are still in this tab.")}</p>
        <div class="editor-v2-context-actions">
          <a class="editor-v2-action" href="${authHref}">Sign in again</a>
          <button class="editor-v2-action" data-context-action="reconnect-session">Open auth</button>
        </div>
        <p class="editor-v2-meta">Unsaved work stays in the editor until you leave or reload.</p>
      </div>
    `;
    return;
  }
  if (conflictFailure) {
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Remote changes detected</h3>
        <p>${escapeHtml(conflictFailure.message || "This document changed on another surface. Your local edits are still in this tab.")}</p>
        <div class="editor-v2-context-actions">
          <button class="editor-v2-action" data-context-action="reload-latest">Reload latest</button>
          <button class="editor-v2-action" data-context-action="retry-save">Retry save</button>
        </div>
        <p class="editor-v2-meta">Reloading will replace the current local snapshot with backend truth.</p>
      </div>
    `;
    return;
  }
  if (transitionFailure) {
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Unsaved edits blocked document switch</h3>
        <p>${escapeHtml(transitionFailure.message || "Latest edits are still unsaved.")}</p>
        <button class="editor-v2-action" data-context-action="retry-save">Retry save</button>
      </div>
    `;
    return;
  }
  if (hydrateFailure) {
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Document context failed to load</h3>
        <p>${escapeHtml(hydrateFailure.message || "Document research context could not be loaded.")}</p>
        <button class="editor-v2-action" data-context-action="retry-hydrate">Retry hydrate</button>
      </div>
    `;
    return;
  }
  if (hydrateActivity?.phase === "running") {
    target.innerHTML = `
      <div class="editor-v2-card">
        <h3>Loading document context</h3>
        <p>Attached research is still hydrating for this document.</p>
      </div>
    `;
    return;
  }
  if (context.mode === "empty_document") {
    target.innerHTML = `<div class="editor-v2-card"><h3>Start writing</h3><p>Use the left rail or create a document to begin.</p></div>`;
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
        <h3>Ready to use</h3>
        <p>${escapeHtml(detail?.excerpt || detail?.citation?.source?.title || "Captured context is ready for writing.")}</p>
        <div class="editor-v2-context-actions">
          <button class="editor-v2-action" data-context-action="insert-seed-quote">Insert quote now</button>
          ${seed?.quote_id ? `<button class="editor-v2-action" data-context-action="convert-quote-to-note" data-quote-id="${escapeHtml(seed.quote_id)}">Convert to note</button>` : ""}
          <button class="editor-v2-action" data-context-action="start-outline">Start outline</button>
        </div>
        <p class="editor-v2-meta">Citation: ${escapeHtml(seed?.citation_id || "none")}</p>
      </div>
    `;
    return;
  }
  if (context.mode === "citation_focus" && detail) {
    target.innerHTML = renderCitationDetail(detail, {
      citationView: handlers.citationViewState?.get?.(detail.id) || {},
      ...(handlers.linkActions?.getCitationDetailOptions?.(detail) || {}),
    });
    return;
  }
  if (context.mode === "quote_focus" && detail) {
    target.innerHTML = renderQuoteDetail(detail, handlers.convertActions?.getQuoteDetailOptions?.(detail) || {});
    return;
  }
  if (context.mode === "note_focus" && detail) {
    target.innerHTML = renderNoteDetail(detail, {
      ...(handlers.linkActions?.getNoteDetailOptions?.(detail) || {}),
      ...(handlers.convertActions?.getNoteDetailOptions?.(detail) || {}),
    });
    return;
  }
  if (context.mode === "source_focus" && detail) {
    target.innerHTML = renderSourceDetail(detail, handlers.linkActions?.getSourceDetailOptions?.(detail) || {});
    return;
  }
  if (state.active_document) {
    target.innerHTML = renderDocumentRelationshipDetail(state.active_document, attached);
    return;
  }
  target.innerHTML = `<div class="editor-v2-card"><h3>Attached research</h3><p>Select text or focus a research item to keep writing with context close by.</p></div>`;
}
