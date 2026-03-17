import { escapeHtml } from "../../app_shell/core/format.js";
import { renderEntityCard } from "./object_cards.js";

export function renderDocumentList(target, documents, activeDocumentId) {
  if (!documents.length) {
    target.innerHTML = `<div class="editor-v2-card">No documents yet.</div>`;
    return;
  }
  target.innerHTML = documents.map((document) => `
    <div data-document-id="${escapeHtml(document.id)}" class="editor-v2-card${document.id === activeDocumentId ? " is-active" : ""}" tabindex="0">
      ${renderEntityCard("document", document)}
    </div>
  `).join("");
}

export function renderExplorerList(target, type, entities, focusedId) {
  if (!entities.length) {
    target.innerHTML = `<div class="editor-v2-card">No ${escapeHtml(type)} ready yet.</div>`;
    return;
  }
  const singular = type.slice(0, -1);
  target.innerHTML = entities.map((entity) => `
    <div data-entity-id="${escapeHtml(entity.id)}" class="editor-v2-card${entity.id === focusedId ? " is-active" : ""}" tabindex="0">
      ${renderEntityCard(singular, entity, { selected: entity.id === focusedId })}
    </div>
  `).join("");
}
