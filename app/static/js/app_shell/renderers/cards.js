import { escapeHtml, formatDateTime, formatRelativeTime, joinText, limitText } from "../core/format.js";

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
        <span class="meta-pill">${counts.citation_count || 0} citations</span>
      </div>
    </article>
  `;
}

export function renderCitationCard(citation, options = {}) {
  const counts = citation.relationship_counts || {};
  const source = citation.source || {};
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-entity-id="${escapeHtml(citation.id)}" tabindex="0" role="button" aria-pressed="${options.selected ? "true" : "false"}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(source.title || "Citation")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(citation.renders?.mla?.bibliography || citation.excerpt || citation.annotation || "Citation saved", 160))}</p>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        <span class="meta-pill">${counts.quote_count || 0} quotes</span>
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
        <span class="meta-pill">${(quote.note_ids || []).length} notes</span>
        <span class="meta-pill">${escapeHtml(formatRelativeTime(quote.updated_at || quote.created_at))}</span>
      </div>
    </article>
  `;
}

export function renderNoteCard(note, options = {}) {
  const projectChip = note.project ? [{ name: note.project.name }] : [];
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-entity-id="${escapeHtml(note.id)}" tabindex="0" role="button" aria-pressed="${options.selected ? "true" : "false"}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(note.title || "Untitled note")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(note.note_body || note.highlight_text || "", 180))}</p>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(note.status || "active")}</span>
        <span class="meta-pill">${(note.sources || []).length} sources</span>
        <span class="meta-pill">${escapeHtml(formatRelativeTime(note.updated_at || note.created_at))}</span>
      </div>
      ${chipRow([...(note.tags || []), ...projectChip])}
    </article>
  `;
}

export function renderProjectCard(project, options = {}) {
  return `
    <article class="research-card${options.selected ? " is-selected" : ""}" data-project-id="${escapeHtml(project.id)}">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(project.name || "Untitled project")}</h3>
      </div>
      <p class="research-card-body">${escapeHtml(limitText(project.description || "A project for connected sources, notes, and documents.", 140))}</p>
      <div class="research-card-meta">
        <span class="project-chip">${escapeHtml(project.color || "No color")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(project.updated_at || project.created_at))}</span>
      </div>
    </article>
  `;
}

export function renderDocumentCard(document) {
  return `
    <article class="research-card">
      <div class="research-card-header">
        <h3 class="research-card-title">${escapeHtml(document.title || "Untitled document")}</h3>
      </div>
      <div class="research-card-meta">
        <span class="meta-pill">${escapeHtml(document.status || "active")}</span>
        <span class="meta-pill">${(document.attached_citation_ids || []).length} citations</span>
        <span class="meta-pill">${escapeHtml(formatRelativeTime(document.updated_at || document.created_at))}</span>
      </div>
      ${chipRow(document.tags || [])}
    </article>
  `;
}
