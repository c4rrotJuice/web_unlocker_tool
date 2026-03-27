import { escapeHtml } from "../../app_shell/core/format.js";

function clip(text, max = 120) {
  const value = String(text || "").trim();
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatRowData(type, entity = {}) {
  if (type === "document") {
    return {
      title: entity.title || "Untitled document",
      subtitle: "",
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
      title: clip(entity.title || entity.citation_text || "Citation", 96),
      subtitle: "",
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
      title: clip(entity.excerpt || entity.text || "Quote", 96),
      subtitle: "",
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
      title: clip(entity.title || entity.text || "Note", 96),
      subtitle: "",
      preview: {
        type,
        title: entity.title || "Note",
        detail: entity.text || "",
        updated: entity.updated_at || "",
      },
    };
  }
  return {
    title: clip(entity.title || entity.url || "Source", 96),
    subtitle: "",
    preview: {
      type,
      title: entity.title || "Source",
      source: entity.url || entity.domain || "",
      detail: entity.summary || "",
    },
  };
}

function rowMarkup({ id, active = false, title = "", subtitle = "", preview = {} }, attributes = "") {
  const previewId = subtitle && id ? `editor-v2-row-${id}-preview` : "";
  return `
    <button ${attributes} class="editor-v2-row${active ? " is-active" : ""}" type="button" tabindex="0" data-preview='${escapeHtml(JSON.stringify(preview))}'${previewId ? ` aria-describedby="${escapeHtml(previewId)}"` : ""}>
      <div class="editor-v2-row-primary">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="editor-v2-row-secondary" id="${escapeHtml(previewId)}">${escapeHtml(subtitle)}</div>` : ""}
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
