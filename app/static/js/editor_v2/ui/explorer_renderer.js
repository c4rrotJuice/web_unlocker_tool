import { escapeHtml } from "../../app_shell/core/format.js";

function formatRowData(type, entity = {}) {
  if (type === "document") {
    return {
      title: entity.title || "Untitled document",
      subtitle: entity.summary || entity.project_name || "",
      preview: {
        type,
        title: entity.title || "Untitled document",
        updated: entity.updated_at || entity.updatedAt || "",
        citations: entity.citation_count ?? ((entity.attached_relation_ids?.citations || []).length || 0),
        notes: entity.note_count ?? ((entity.attached_relation_ids?.notes || []).length || 0),
        project: entity.project_name || entity.project_id || "",
      },
    };
  }
  if (type === "citation") {
    return {
      title: entity.title || entity.citation_text || "Citation",
      subtitle: entity.authors?.[0] || entity.source_title || "",
      preview: {
        type,
        title: entity.title || entity.citation_text || "Citation",
        source: entity.source_title || entity.source?.title || "",
        year: entity.year || "",
        detail: entity.citation_text || entity.snippet || "",
      },
    };
  }
  if (type === "quote") {
    return {
      title: entity.excerpt || entity.text || "Quote",
      subtitle: entity.source_title || entity.citation?.source?.title || "",
      preview: {
        type,
        title: entity.excerpt || entity.text || "Quote",
        source: entity.source_title || entity.citation?.source?.title || "",
        detail: entity.text || entity.excerpt || "",
      },
    };
  }
  if (type === "note") {
    return {
      title: entity.title || entity.text || "Note",
      subtitle: entity.updated_at || "",
      preview: {
        type,
        title: entity.title || "Note",
        detail: entity.text || "",
        updated: entity.updated_at || "",
      },
    };
  }
  return {
    title: entity.title || entity.url || "Source",
    subtitle: entity.domain || entity.url || "",
    preview: {
      type,
      title: entity.title || "Source",
      source: entity.url || entity.domain || "",
      detail: entity.summary || "",
    },
  };
}

function rowMarkup({ id, active = false, title = "", subtitle = "", preview = {} }, attributes = "") {
  return `
    <button ${attributes} class="editor-v2-row${active ? " is-active" : ""}" type="button" tabindex="0" data-preview='${escapeHtml(JSON.stringify(preview))}'>
      <div class="editor-v2-row-primary">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="editor-v2-row-secondary">${escapeHtml(subtitle)}</div>` : ""}
    </button>
  `;
}

export function renderDocumentList(target, documents, activeDocumentId) {
  if (!documents.length) {
    target.innerHTML = `<div class="editor-v2-card">No documents yet.</div>`;
    return;
  }
  target.innerHTML = documents.map((document) => {
    const row = formatRowData("document", document);
    return rowMarkup({
      id: document.id,
      active: document.id === activeDocumentId,
      title: row.title,
      subtitle: row.subtitle,
      preview: row.preview,
    }, `data-document-id="${escapeHtml(document.id)}"`);
  }).join("");
}

export function renderExplorerList(target, type, entities, focusedId) {
  if (!entities.length) {
    target.innerHTML = `<div class="editor-v2-card">No ${escapeHtml(type)} ready yet.</div>`;
    return;
  }
  const singular = type.slice(0, -1);
  target.innerHTML = entities.map((entity) => {
    const row = formatRowData(singular, entity);
    return rowMarkup({
      id: entity.id,
      active: entity.id === focusedId,
      title: row.title,
      subtitle: row.subtitle,
      preview: row.preview,
    }, `data-entity-id="${escapeHtml(entity.id)}" data-entity-type="${escapeHtml(singular)}"`);
  }).join("");
}
