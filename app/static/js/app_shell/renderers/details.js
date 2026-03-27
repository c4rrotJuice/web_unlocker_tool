import { escapeHtml, formatDateTime, limitText } from "../core/format.js";
import { citationPrimaryText, citationRenderEntries } from "../../shared/citation_contract.js";
import { renderCitationCard, renderDocumentCard, renderNoteCard, renderQuoteCard, renderSourceCard } from "./cards.js";

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
      <p class="detail-copy">${escapeHtml(citationPrimaryText(citation))}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(citation.updated_at || citation.created_at))}</span>
      </div>
    </section>
    ${detailList("Available renders", citationRenderEntries(citation).map(({ style, text }) => `<strong>${escapeHtml((style || "").toUpperCase())}</strong><br>${escapeHtml(text || "")}`), "No render output available.")}
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

function singular(type) {
  return type.endsWith("s") ? type.slice(0, -1) : type;
}

function renderEntitySection(title, type, rows, emptyLabel) {
  if (!rows.length) {
    return detailList(title, [], emptyLabel);
  }
  const renderers = {
    source: renderSourceCard,
    citation: renderCitationCard,
    quote: renderQuoteCard,
    note: renderNoteCard,
    document: renderDocumentCard,
  };
  const renderer = renderers[type];
  return `
    <section class="detail-section">
      <p class="section-kicker">${escapeHtml(title)}</p>
      <div class="card-stack">
        ${rows.map((row) => {
          if (type === "document") {
            return `<div class="detail-nav-card" data-related-document-id="${escapeHtml(row.id)}">${renderer(row)}</div>`;
          }
          return `<div class="detail-nav-card" data-related-entity-type="${escapeHtml(type)}" data-related-entity-id="${escapeHtml(row.id)}">${renderer(row)}</div>`;
        }).join("")}
      </div>
    </section>
  `;
}

function renderWorkflowLink(href) {
  return `
    <section class="detail-section">
      <a class="app-button-secondary" href="${escapeHtml(href)}">Open in editor</a>
    </section>
  `;
}

function buildEditorHref(graph) {
  const node = graph?.node || {};
  const data = node.data || {};
  const collections = graph?.collections || {};
  const params = new URLSearchParams();
  params.set("seeded", "1");
  params.set("seed_mode", "seed_review");
  if (node.type === "source") {
    params.set("seed_source_id", data.id || "");
    if (collections.citations?.[0]?.id) params.set("seed_citation_id", collections.citations[0].id);
  } else if (node.type === "citation") {
    params.set("seed_citation_id", data.id || "");
    if (data.source?.id) params.set("seed_source_id", data.source.id);
  } else if (node.type === "quote") {
    params.set("seed_quote_id", data.id || "");
    if (data.citation?.id) params.set("seed_citation_id", data.citation.id);
    if (data.citation?.source?.id) params.set("seed_source_id", data.citation.source.id);
  } else if (node.type === "note") {
    params.set("seed_note_id", data.id || "");
    if (data.citation_id) params.set("seed_citation_id", data.citation_id);
    if (data.quote_id) params.set("seed_quote_id", data.quote_id);
    if (data.sources?.[0]?.source_id) params.set("seed_source_id", data.sources[0].source_id);
  }
  return `/editor?${params.toString()}`;
}

export function renderGraphDetail(graph) {
  const node = graph?.node || {};
  const collections = graph?.collections || {};
  const current = node.data || {};
  const sources = (collections.sources || []).filter((item) => !(node.type === "source" && item.id === current.id));
  const citations = (collections.citations || []).filter((item) => !(node.type === "citation" && item.id === current.id));
  const quotes = (collections.quotes || []).filter((item) => !(node.type === "quote" && item.id === current.id));
  const notes = (collections.notes || []).filter((item) => !(node.type === "note" && item.id === current.id));
  const documents = collections.documents || [];

  const primarySections = [];
  if (node.type === "source") {
    primarySections.push(renderSourceDetail(current));
    primarySections.push(renderEntitySection("Citations", "citation", citations, "No citations connected to this source yet."));
    primarySections.push(renderEntitySection("Quotes", "quote", quotes, "No quotes connected to this source yet."));
    primarySections.push(renderEntitySection("Notes", "note", notes, "No notes connected to this source yet."));
    primarySections.push(renderEntitySection("Documents using this source", "document", documents, "No documents use this source yet."));
  } else if (node.type === "citation") {
    primarySections.push(renderCitationDetail(current));
    primarySections.push(renderEntitySection("Source", "source", current.source ? [current.source] : [], "No source linked to this citation."));
    primarySections.push(renderEntitySection("Quotes", "quote", quotes, "No quotes linked to this citation yet."));
    primarySections.push(renderEntitySection("Notes", "note", notes, "No notes linked to this citation yet."));
    primarySections.push(renderEntitySection("Documents using this citation", "document", documents, "No documents use this citation yet."));
  } else if (node.type === "quote") {
    primarySections.push(renderQuoteDetail(current));
    primarySections.push(renderEntitySection("Parent source", "source", current.citation?.source ? [current.citation.source] : [], "No parent source available."));
    primarySections.push(renderEntitySection("Citation", "citation", current.citation ? [current.citation] : [], "No citation available."));
    primarySections.push(renderEntitySection("Derived notes", "note", notes, "No notes derived from this quote yet."));
    primarySections.push(renderEntitySection("Documents in this quote neighborhood", "document", documents, "No documents connected to this quote yet."));
  } else if (node.type === "note") {
    primarySections.push(renderNoteDetail(current));
    primarySections.push(renderEntitySection("Linked sources", "source", sources, "No linked sources on this note."));
    primarySections.push(renderEntitySection("Linked quote", "quote", quotes, "No linked quote on this note."));
    primarySections.push(renderEntitySection("Related notes", "note", notes, "No related notes yet."));
    primarySections.push(renderEntitySection("Documents using this note", "document", documents, "No documents use this note yet."));
  } else {
    primarySections.push(`<section class="detail-section"><h3>${escapeHtml(singular(node.type || "item"))}</h3></section>`);
  }

  primarySections.push(renderWorkflowLink(buildEditorHref(graph)));
  return primarySections.join("");
}
