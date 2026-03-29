import { escapeHtml, formatDateTime, formatRelativeTime, joinText, limitText } from "../core/format.js";
import { citationDisplayTitle, citationPrimaryText } from "../../shared/citation_contract.js";
import { renderMetaCount, relationshipCount } from "./relationships.js";

function chipRow(tags = []) {
  if (!tags.length) return "";
  return `<div class="chip-row">${tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag.name || tag.label || "")}</span>`).join("")}</div>`;
}

export function renderSourceCard(source, options = {}) {
  const counts = source.relationship_counts || {};
  const meta = joinText([
    source.hostname,
    source.publisher,
    formatDateTime(source.updated_at || source.created_at),
  ]);
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-entity-id="${escapeHtml(source.id)}" tabindex="0" role="button" aria-pressed="${options.selected ? "true" : "false"}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(source.title || "Untitled source")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(source.container_title || source.canonical_url || "", 120))}</p>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(meta || "Source")}</span>
        ${renderMetaCount("citations", counts.citation_count)}
      </div>
    </article>
  `;
}

export function renderCitationCard(citation, options = {}) {
  const counts = citation.relationship_counts || {};
  const source = citation.source || {};
  const title = citationDisplayTitle(citation, "Citation");
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-entity-id="${escapeHtml(citation.id)}" tabindex="0" role="button" aria-pressed="${options.selected ? "true" : "false"}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(limitText(title, 96))}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(citationPrimaryText(citation), 160))}</p>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        ${renderMetaCount("quotes", counts.quote_count)}
        ${relationshipCount(counts.note_count, 0) ? renderMetaCount("notes", counts.note_count) : ""}
        <span class="meta-pill">${escapeHtml(formatRelativeTime(citation.updated_at || citation.created_at))}</span>
      </div>
    </article>
  `;
}

export function renderQuoteCard(quote, options = {}) {
  const citation = quote.citation || {};
  const source = citation.source || {};
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-entity-id="${escapeHtml(quote.id)}" tabindex="0" role="button" aria-pressed="${options.selected ? "true" : "false"}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(source.title || "Quote")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(quote.excerpt || "", 180))}</p>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Citation")}</span>
        ${renderMetaCount("notes", (quote.note_ids || []).length)}
        <span class="meta-pill">${escapeHtml(formatRelativeTime(quote.updated_at || quote.created_at))}</span>
      </div>
    </article>
  `;
}

export function renderNoteCard(note, options = {}) {
  const projectChip = note.project ? [{ name: note.project.name }] : [];
  const relatedNoteCount = relationshipCount(note?.relationship_groups?.note_links_by_type?.supports?.length, 0)
    + relationshipCount(note?.relationship_groups?.note_links_by_type?.contradicts?.length, 0)
    + relationshipCount(note?.relationship_groups?.note_links_by_type?.extends?.length, 0)
    + relationshipCount(note?.relationship_groups?.note_links_by_type?.related?.length, 0)
    + (Array.isArray(note.note_links) && !note.relationship_groups?.note_links_by_type ? note.note_links.length : 0);
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-entity-id="${escapeHtml(note.id)}" tabindex="0" role="button" aria-pressed="${options.selected ? "true" : "false"}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(note.title || "Untitled note")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(note.note_body || note.highlight_text || "", 180))}</p>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(note.status || "active")}</span>
        ${renderMetaCount("evidence", (note.evidence_links || []).length)}
        ${relatedNoteCount ? renderMetaCount("related notes", relatedNoteCount) : ""}
        <span class="meta-pill">${escapeHtml(formatRelativeTime(note.updated_at || note.created_at))}</span>
      </div>
      ${chipRow([...(note.tags || []), ...projectChip])}
    </article>
  `;
}

export function renderProjectCard(project, options = {}) {
  const counts = project.relationship_counts || {};
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-project-id="${escapeHtml(project.id)}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(project.name || "Untitled project")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(project.description || "A project for connected sources, notes, and documents.", 140))}</p>
      <div class="research-card-meta">
        <span class="project-chip">${escapeHtml(project.color || "No color")}</span>
        ${relationshipCount(counts.note_count, 0) ? renderMetaCount("notes", counts.note_count) : ""}
        ${relationshipCount(counts.document_count, 0) ? renderMetaCount("documents", counts.document_count) : ""}
        <span class="meta-pill">${escapeHtml(formatDateTime(project.updated_at || project.created_at))}</span>
      </div>
    </article>
  `;
}

export function renderDocumentCard(document) {
  const attachedNoteCount = Array.isArray(document.attached_note_ids) ? document.attached_note_ids.length : 0;
  return `
    <article class="research-card">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(document.title || "Untitled document")}</h3>
      </div>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(document.status || "active")}</span>
        ${renderMetaCount("attached citations", (document.attached_citation_ids || []).length)}
        ${attachedNoteCount ? renderMetaCount("attached notes", attachedNoteCount) : ""}
        <span class="meta-pill">${escapeHtml(formatRelativeTime(document.updated_at || document.created_at))}</span>
      </div>
      ${chipRow(document.tags || [])}
    </article>
  `;
}
