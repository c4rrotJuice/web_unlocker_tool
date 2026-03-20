import { escapeHtml, formatDateTime, limitText } from "../core/format.js";

function detailList(title, items, emptyLabel) {
  return `
    <section class="detail-section">
      <p class="section-kicker">${escapeHtml(title)}</p>
      ${items.length
        ? `<div class="detail-list">${items.map((item) => `<div class="detail-list-item">${item}</div>`).join("")}</div>`
        : `<div class="surface-note">${escapeHtml(emptyLabel)}</div>`}
    </section>
  `;
}

export function renderSourceDetail(source) {
  const counts = source.relationship_counts || {};
  return `
    <section class="detail-section">
      <h3>${escapeHtml(source.title || "Untitled source")}</h3>
      <p class="detail-copy">${escapeHtml(limitText(source.container_title || source.canonical_url || "Source metadata", 220))}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        <span class="meta-pill">${counts.citation_count || 0} citations</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(source.updated_at || source.created_at))}</span>
      </div>
    </section>
  `;
}

export function renderCitationDetail(citation) {
  const source = citation.source || {};
  return `
    <section class="detail-section">
      <h3>${escapeHtml(source.title || "Citation")}</h3>
      <p class="detail-copy">${escapeHtml(citation.renders?.mla?.bibliography || citation.excerpt || citation.annotation || "Citation saved")}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(citation.updated_at || citation.created_at))}</span>
      </div>
    </section>
    ${detailList("Available renders", Object.entries(citation.renders || {}).map(([style, payload]) => `<strong>${escapeHtml(style.toUpperCase())}</strong><br>${escapeHtml(payload.bibliography || payload.footnote || "")}`), "No render output available.")}
  `;
}

export function renderQuoteDetail(quote) {
  const source = quote.citation?.source || {};
  return `
    <section class="detail-section">
      <h3>${escapeHtml(source.title || "Quote")}</h3>
      <p class="detail-copy">${escapeHtml(quote.excerpt || "")}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Citation")}</span>
        <span class="meta-pill">${(quote.note_ids || []).length} linked notes</span>
      </div>
    </section>
    ${detailList("Linked note ids", (quote.note_ids || []).map((id) => escapeHtml(id)), "No linked notes yet.")}
  `;
}

export function renderNoteDetail(note) {
  return `
    <section class="detail-section">
      <h3>${escapeHtml(note.title || "Untitled note")}</h3>
      <p class="detail-copy">${escapeHtml(note.note_body || note.highlight_text || "")}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(note.status || "active")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(note.updated_at || note.created_at))}</span>
      </div>
    </section>
    ${detailList("Evidence", (note.sources || []).map((source) => escapeHtml(source.title || source.url || source.hostname || "Source")), "No attached evidence yet.")}
    ${detailList("Tags", (note.tags || []).map((tag) => escapeHtml(tag.name || "")), "No tags on this note.")}
  `;
}
