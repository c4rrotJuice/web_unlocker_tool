import { escapeHtml, formatDateTime, limitText } from "../core/format.js";
import {
  CITATION_RENDER_KINDS,
  CITATION_STYLES,
  citationRenderEntries,
  resolveCitationView,
} from "../../shared/citation_contract.js";
import { renderCitationCard, renderDocumentCard, renderNoteCard, renderQuoteCard, renderSourceCard } from "./cards.js";
import { renderProjectAssignmentControl } from "./project_organization.js";
import {
  EVIDENCE_ROLE_LABELS,
  EVIDENCE_ROLE_ORDER,
  NOTE_LINK_TYPE_LABELS,
  NOTE_LINK_TYPE_ORDER,
  relationshipCount,
  renderGroupedRelationshipSection,
  renderRelationshipSummary,
} from "./relationships.js";

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

function renderNoteHubChooser(options = {}) {
  const noteHubLink = options?.noteHubLink;
  if (!noteHubLink?.supported) return "";
  const chooser = noteHubLink.chooser || null;
  const targetLabel = noteHubLink.targetLabel || "research item";
  return `
    <section class="detail-section">
      <p class="section-kicker">Link to note</p>
      <p class="surface-note">Choose the owning note first. Relationship typing stays note-scoped.</p>
      <div class="detail-chip-row">
        <button
          type="button"
          class="app-button-secondary"
          data-note-hub-link-open="${escapeHtml(noteHubLink.targetKind || "")}"
          data-target-id="${escapeHtml(noteHubLink.targetId || "")}"
          data-target-label="${escapeHtml(targetLabel)}"
          data-target-subtitle="${escapeHtml(options.targetSubtitle || "")}"
          data-target-url="${escapeHtml(options.targetUrl || "")}"
          data-target-hostname="${escapeHtml(options.targetHostname || "")}"
          data-source-id="${escapeHtml(options.sourceId || "")}"
        >Link to note…</button>
      </div>
      ${chooser ? `
        <div class="detail-list">
          <div class="detail-list-item">
            <strong>${escapeHtml(targetLabel)}</strong>
            <span class="relationship-item-meta">Choose the note that owns this relationship.</span>
          </div>
        </div>
        <div class="detail-chip-row">
          <input type="search" value="${escapeHtml(chooser.query || "")}" placeholder="Search notes" data-note-hub-query />
          <button type="button" class="app-button-secondary" data-note-hub-search ${chooser.pending ? "disabled" : ""}>Refresh choices</button>
          <button type="button" class="app-button-secondary" data-note-hub-cancel>Cancel</button>
        </div>
        ${chooser.error ? `<div class="surface-note">${escapeHtml(chooser.error)}</div>` : ""}
        ${chooser.pending
          ? '<div class="surface-note">Loading notes…</div>'
          : chooser.results?.length
            ? `<div class="detail-list">${chooser.results.map((row) => `
              <div class="detail-list-item">
                <div class="relationship-item-copy">
                  <strong>${escapeHtml(row.label || "Untitled note")}</strong>
                  ${row.subtitle ? `<span class="relationship-item-meta">${escapeHtml(row.subtitle)}</span>` : ""}
                </div>
                <div class="detail-chip-row">
                  <button type="button" class="app-button-secondary" data-note-hub-note-pick="${escapeHtml(row.id || "")}">Use note</button>
                </div>
              </div>
            `).join("")}</div>`
            : '<div class="surface-note">No notes available for this handoff yet.</div>'}
      ` : ""}
    </section>
  `;
}

function renderEditableRelationshipGroup({
  title,
  noteId,
  groups,
  order,
  labels,
  emptyLabel,
  renderItem,
  relationKind,
}) {
  const normalizedGroups = groups && typeof groups === "object" ? groups : null;
  if (!normalizedGroups) return "";
  const hasItems = order.some((key) => Array.isArray(normalizedGroups[key]) && normalizedGroups[key].length);
  return `
    <section class="detail-section">
      <p class="section-kicker">${escapeHtml(title)}</p>
      ${hasItems
        ? `<div class="relationship-group-stack">
          ${order.map((key) => {
            const rows = Array.isArray(normalizedGroups[key]) ? normalizedGroups[key] : [];
            return `
              <article class="relationship-group">
                <h4 class="relationship-group-title">${escapeHtml(labels[key] || key)}</h4>
                ${rows.length
                  ? `<div class="detail-list">${rows.map((row) => renderItem(row, key, noteId, relationKind)).join("")}</div>`
                  : `<div class="surface-note">${escapeHtml(`No ${String(labels[key] || key).toLowerCase()} yet.`)}</div>`}
              </article>
            `;
          }).join("")}
        </div>`
        : `<div class="surface-note">${escapeHtml(emptyLabel)}</div>`}
    </section>
  `;
}

function renderNoteAuthoringPanel(note, options = {}) {
  const authoring = options?.authoring;
  if (!authoring?.supported) return "";
  const panel = authoring.panel || null;
  return `
    <section class="detail-section">
      <p class="section-kicker">Author relationships</p>
      <p class="surface-note">This note is the only place where research relationships are authored.</p>
      <div class="detail-chip-row">
        <button type="button" class="app-button-secondary" data-note-authoring-open="note_link" data-note-id="${escapeHtml(note?.id || "")}">Link note</button>
        <button type="button" class="app-button-secondary" data-note-authoring-open="source_evidence" data-note-id="${escapeHtml(note?.id || "")}">Link source as evidence</button>
        <button type="button" class="app-button-secondary" data-note-authoring-open="citation_evidence" data-note-id="${escapeHtml(note?.id || "")}">Link citation as evidence</button>
        <button type="button" class="app-button-secondary" data-note-authoring-open="external_evidence" data-note-id="${escapeHtml(note?.id || "")}">Link supporting URL</button>
      </div>
      ${panel ? `
        <div class="detail-section">
          <p class="section-kicker">${escapeHtml(panel.kind === "note_link"
            ? "Typed note link"
            : panel.kind === "source_evidence"
              ? "Source evidence"
              : panel.kind === "citation_evidence"
                ? "Citation evidence"
                : "External evidence")}</p>
          ${panel.kind === "note_link" || panel.kind === "source_evidence" || panel.kind === "citation_evidence"
            ? `
              ${panel.selectedTarget ? `
                <div class="detail-list">
                  <div class="detail-list-item">
                    <div class="relationship-item-copy">
                      <strong>${escapeHtml(panel.selectedTarget.label || "Selected target")}</strong>
                      ${panel.selectedTarget.subtitle ? `<span class="relationship-item-meta">${escapeHtml(panel.selectedTarget.subtitle)}</span>` : ""}
                    </div>
                  </div>
                </div>
              ` : ""}
              ${panel.selectedTarget ? "" : `
                <div class="detail-chip-row">
                  <input type="search" value="${escapeHtml(panel.query || "")}" placeholder="Search choices" data-note-authoring-query />
                  <button type="button" class="app-button-secondary" data-note-authoring-search ${panel.pending ? "disabled" : ""}>Refresh choices</button>
                </div>
                ${panel.pending
                  ? '<div class="surface-note">Loading choices…</div>'
                  : panel.results?.length
                    ? `<div class="detail-list">${panel.results.map((row) => `
                      <div class="detail-list-item">
                        <div class="relationship-item-copy">
                          <strong>${escapeHtml(row.label || "Untitled")}</strong>
                          ${row.subtitle ? `<span class="relationship-item-meta">${escapeHtml(row.subtitle)}</span>` : ""}
                        </div>
                        <div class="detail-chip-row">
                          <button type="button" class="app-button-secondary" data-note-authoring-target="${escapeHtml(row.id || "")}">Choose</button>
                        </div>
                      </div>
                    `).join("")}</div>`
                    : '<div class="surface-note">No matching choices yet.</div>'}
              `}
            `
            : `
              <div class="detail-chip-row">
                <input type="url" value="${escapeHtml(panel.url || "")}" placeholder="https://example.com/evidence" data-note-authoring-url />
                <input type="text" value="${escapeHtml(panel.title || "")}" placeholder="Optional title" data-note-authoring-title />
              </div>
            `}
          <div class="detail-chip-row">
            ${panel.kind === "note_link"
              ? `<label><span class="surface-note">Link type</span><select data-note-authoring-link-type>
                  ${NOTE_LINK_TYPE_ORDER.map((key) => `<option value="${escapeHtml(key)}"${key === panel.linkType ? " selected" : ""}>${escapeHtml(NOTE_LINK_TYPE_LABELS[key] || key)}</option>`).join("")}
                </select></label>`
              : `<label><span class="surface-note">Evidence role</span><select data-note-authoring-evidence-role>
                  ${EVIDENCE_ROLE_ORDER.map((key) => `<option value="${escapeHtml(key)}"${key === panel.evidenceRole ? " selected" : ""}>${escapeHtml(EVIDENCE_ROLE_LABELS[key] || key)}</option>`).join("")}
                </select></label>`}
          </div>
          ${panel.preview ? `
            <div class="detail-list">
              <div class="detail-list-item">
                <div class="relationship-item-copy">
                  <strong>${escapeHtml(panel.preview.label || "Preview")}</strong>
                  ${panel.preview.detail ? `<span class="relationship-item-meta">${escapeHtml(panel.preview.detail)}</span>` : ""}
                </div>
              </div>
            </div>
          ` : ""}
          ${panel.error ? `<div class="surface-note">${escapeHtml(panel.error)}</div>` : ""}
          <div class="detail-chip-row">
            <button type="button" class="app-button-secondary" data-note-authoring-save ${panel.saving ? "disabled" : ""}>${escapeHtml(panel.saving ? "Saving…" : "Save relationship")}</button>
            <button type="button" class="app-button-secondary" data-note-authoring-cancel>Cancel</button>
          </div>
        </div>
      ` : ""}
    </section>
  `;
}

export function renderSourceDetail(source, options = {}) {
  const counts = source.relationship_counts || {};
  return `
    <section class="detail-section">
      <h3>${escapeHtml(source.title || "Untitled source")}</h3>
      <p class="detail-copy">${escapeHtml(limitText(source.container_title || source.canonical_url || "Source metadata", 220))}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        <span class="meta-pill">${counts.citation_count || 0} citations</span>
        ${relationshipCount(counts.note_count, 0) ? `<span class="meta-pill">${counts.note_count} notes</span>` : ""}
        ${relationshipCount(counts.document_count, 0) ? `<span class="meta-pill">${counts.document_count} documents</span>` : ""}
        <span class="meta-pill">${escapeHtml(formatDateTime(source.updated_at || source.created_at))}</span>
      </div>
    </section>
    ${renderNoteHubChooser({
      ...options,
      targetSubtitle: source.hostname || source.publisher || "",
      targetUrl: source.canonical_url || source.page_url || "",
      targetHostname: source.hostname || "",
    })}
  `;
}

function renderCitationControls(citation, view) {
  const citationId = escapeHtml(citation?.id || "");
  return `
    <section class="detail-section" data-citation-controls="${citationId}">
      <p class="section-kicker">Citation View</p>
      <div class="detail-chip-row">
        <label>
          <span class="surface-note">Style</span>
          <select data-citation-style-select="${citationId}">
            ${CITATION_STYLES.map((style) => `<option value="${escapeHtml(style)}"${style === view.style ? " selected" : ""}>${escapeHtml(style.toUpperCase())}</option>`).join("")}
          </select>
        </label>
        <label>
          <span class="surface-note">Render</span>
          <select data-citation-kind-select="${citationId}">
            ${CITATION_RENDER_KINDS.map((kind) => `<option value="${escapeHtml(kind)}"${kind === view.kind ? " selected" : ""}>${escapeHtml(kind.replace(/_/g, " "))}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="app-button-secondary" data-citation-copy="${citationId}">Copy</button>
      </div>
      ${view.message ? `<div class="surface-note" data-citation-status="${citationId}">${escapeHtml(view.message)}</div>` : ""}
    </section>
  `;
}

function renderDocumentAttachmentSection(entityType, entityId, attachAction, copy) {
  if (!attachAction?.supported) return "";
  const escapedEntityId = escapeHtml(entityId || "");
  const escapedDocumentTitle = escapeHtml(attachAction.documentTitle || "Current document");
  const escapedStatus = escapeHtml(attachAction.statusLabel || (attachAction.attached ? "Attached" : "Not attached"));
  const escapedFailure = escapeHtml(attachAction.failureMessage || "");
  const attachDataset = entityType === "citation"
    ? `data-context-action="attach-citation-to-document" data-citation-id="${escapedEntityId}"`
    : `data-context-action="attach-note-to-document" data-note-id="${escapedEntityId}"`;
  const detachDataset = entityType === "citation"
    ? `data-context-action="detach-citation-from-document" data-citation-id="${escapedEntityId}"`
    : `data-context-action="detach-note-from-document" data-note-id="${escapedEntityId}"`;

  return `
    <section class="detail-section">
      <p class="section-kicker">Document attachment</p>
      <p class="surface-note">${escapeHtml(copy)}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapedDocumentTitle}</span>
        <span class="meta-pill">${escapedStatus}</span>
      </div>
      <div class="detail-chip-row">
        ${attachAction.attached
          ? ""
          : `<button type="button" class="app-button-secondary" ${attachDataset} ${attachAction.pending ? "disabled" : ""}>${escapeHtml(attachAction.label || "Attach to current document")}</button>`}
        ${attachAction.canDetach
          ? `<button type="button" class="app-button-secondary" ${detachDataset} ${attachAction.pending ? "disabled" : ""}>${escapeHtml(attachAction.removeLabel || "Remove attachment")}</button>`
          : ""}
      </div>
      ${escapedFailure ? `<div class="surface-note">${escapedFailure}</div>` : ""}
    </section>
  `;
}

export function renderCitationDetail(citation, options = {}) {
  const source = citation.source || {};
  const view = resolveCitationView(citation, options?.citationView || {});
  return `
    <section class="detail-section">
      <h3>${escapeHtml(source.title || "Citation")}</h3>
      <p class="detail-copy">${escapeHtml(view.text || "Citation render unavailable.")}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(view.style.toUpperCase())}</span>
        <span class="meta-pill">${escapeHtml(view.kind.replace(/_/g, " "))}</span>
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Source")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(citation.updated_at || citation.created_at))}</span>
      </div>
    </section>
    ${renderCitationControls(citation, view)}
    ${renderDocumentAttachmentSection(
      "citation",
      citation?.id,
      options.attachAction || null,
      "Insert places citation chips in the draft. Attach keeps this citation linked to the current document.",
    )}
    ${renderNoteHubChooser({
      ...options,
      targetSubtitle: source.hostname || source.publisher || "",
      targetUrl: source.canonical_url || source.page_url || "",
      targetHostname: source.hostname || "",
      sourceId: source.id || citation.source_id || "",
    })}
    ${detailList(`Available renders in ${view.style.toUpperCase()}`, citationRenderEntries(citation, { style: view.style }).map(({ style, kind, text }) => `<strong>${escapeHtml((style || "").toUpperCase())} · ${escapeHtml((kind || "").replace(/_/g, " "))}</strong><br>${escapeHtml(text || "")}`), "No render output available.")}
  `;
}

function renderQuoteConversionSection(quote, options = {}) {
  const convertAction = options.convertAction || null;
  if (!convertAction?.supported || !quote?.id) return "";
  return `
    <section class="detail-section">
      <p class="section-kicker">Conversion</p>
      <p class="surface-note">Convert Quote to Note creates a real note and preserves quote and citation lineage.</p>
      <div class="detail-chip-row">
        <button
          type="button"
          class="app-button-secondary"
          data-context-action="convert-quote-to-note"
          data-quote-id="${escapeHtml(quote.id)}"
        >${escapeHtml(convertAction.label || "Convert Quote to Note")}</button>
      </div>
    </section>
  `;
}

export function renderQuoteDetail(quote, options = {}) {
  const source = quote.citation?.source || {};
  const derivedNotes = dedupeRows(options.derivedNotes || quote?.neighborhood?.notes || []);
  const derivedNoteIds = Array.isArray(quote?.note_ids) ? quote.note_ids : [];
  return `
    <section class="detail-section">
      <h3>${escapeHtml(source.title || "Quote")}</h3>
      <p class="detail-copy">${escapeHtml(quote.excerpt || "")}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(source.hostname || source.publisher || "Citation")}</span>
        <span class="meta-pill">${derivedNoteIds.length} derived notes</span>
      </div>
    </section>
    ${renderQuoteConversionSection(quote, options)}
    ${derivedNotes.length
      ? renderEntitySection("Derived notes", "note", derivedNotes, "No derived notes yet.")
      : detailList("Derived note ids", derivedNoteIds.map((id) => escapeHtml(id)), "No derived notes yet.")}
  `;
}

function renderEvidenceItem(source, _groupKey, noteId) {
  const label = source?.display?.label || source?.title || source?.url || source?.hostname || "Evidence";
  const subtitle = source?.display?.subtitle || source?.hostname || source?.target_kind || "";
  const key = source?.id
    ? `id:${source.id}`
    : source?.citation_id
      ? `citation:${source.citation_id}`
      : source?.source_id
        ? `source:${source.source_id}`
        : `url:${source?.url || ""}`;
  return `
    <div class="detail-list-item">
      <div class="relationship-item-copy">
        <strong>${escapeHtml(label)}</strong>
        ${subtitle ? `<span class="relationship-item-meta">${escapeHtml(subtitle)}</span>` : ""}
      </div>
      <div class="detail-chip-row">
        <button type="button" class="app-button-secondary" data-note-relation-edit="evidence" data-note-id="${escapeHtml(noteId || "")}" data-relation-key="${escapeHtml(key)}">Edit</button>
        <button type="button" class="app-button-secondary" data-note-relation-remove="evidence" data-note-id="${escapeHtml(noteId || "")}" data-relation-key="${escapeHtml(key)}">Remove</button>
      </div>
    </div>
  `;
}

function renderRelatedNoteItem(entry, _groupKey, noteId) {
  const note = entry?.note || {};
  const link = entry?.link || {};
  const title = note?.title || note?.note_body || note?.highlight_text || link?.linked_note_id || "Related note";
  const subtitle = note?.status || link?.linked_note_id || "";
  return `
    <div class="detail-list-item">
      <div class="relationship-item-copy">
        <strong>${escapeHtml(title)}</strong>
        ${subtitle ? `<span class="relationship-item-meta">${escapeHtml(subtitle)}</span>` : ""}
      </div>
      <div class="detail-chip-row">
        <button type="button" class="app-button-secondary" data-note-relation-edit="note-link" data-note-id="${escapeHtml(noteId || "")}" data-relation-key="${escapeHtml(link?.linked_note_id || "")}">Edit</button>
        <button type="button" class="app-button-secondary" data-note-relation-remove="note-link" data-note-id="${escapeHtml(noteId || "")}" data-relation-key="${escapeHtml(link?.linked_note_id || "")}">Remove</button>
      </div>
    </div>
  `;
}

function renderLineageSection(note) {
  const lineage = note?.lineage || {};
  if (!lineage.citation && !lineage.quote) return "";
  return `
    <section class="detail-section">
      <p class="section-kicker">Lineage</p>
      <p class="surface-note">This note keeps canonical quote and citation lineage from the research graph.</p>
    </section>
    ${lineage.citation ? renderEntitySection("From citation", "citation", [lineage.citation], "No lineage citation.") : ""}
    ${lineage.quote ? renderEntitySection("From quote", "quote", [lineage.quote], "No lineage quote.") : ""}
  `;
}

function renderNoteInsertSection(note, options = {}) {
  const insertAction = options.insertAction || null;
  if (!insertAction?.supported || !note?.id) return "";
  return `
    <section class="detail-section">
      <p class="section-kicker">Writing actions</p>
      <p class="surface-note">Insert places this note into the current draft while preserving its note context.</p>
      <div class="detail-chip-row">
        <button
          type="button"
          class="app-button-secondary"
          data-context-action="insert-note-into-document"
          data-note-id="${escapeHtml(note.id)}"
        >${escapeHtml(insertAction.label || "Insert note")}</button>
      </div>
    </section>
  `;
}

export function renderNoteDetail(note, options = {}) {
  const linkedDocuments = dedupeRows(options.documents || []);
  const attachAction = options.attachAction || null;
  const attachedDocuments = Array.isArray(note?.attached_documents) ? note.attached_documents : linkedDocuments;
  const relationshipGroups = note?.relationship_groups || {};
  const evidenceGroups = relationshipGroups.evidence_links_by_role;
  const noteLinkGroups = relationshipGroups.note_links_by_type;
  return `
    <section class="detail-section">
      <h3>${escapeHtml(note.title || "Untitled note")}</h3>
      <p class="detail-copy">${escapeHtml(note.note_body || note.highlight_text || "")}</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(note.status || "active")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(note.updated_at || note.created_at))}</span>
      </div>
    </section>
    ${renderDocumentAttachmentSection(
      "note",
      note?.id,
      attachAction,
      "Insert places note markers in the draft. Attach keeps this note linked to the current document.",
    )}
    ${options?.projectAssignment?.supported ? renderProjectAssignmentControl({ entityType: "note", entity: note, projects: options.projectAssignment.projects || [] }) : ""}
    ${renderNoteInsertSection(note, options)}
    ${Array.isArray(note?.attached_documents) || linkedDocuments.length
      ? renderEntitySection("Attached documents", "document", attachedDocuments, "This note is not attached to any documents yet.")
      : ""}
    ${renderLineageSection(note)}
    ${renderNoteAuthoringPanel(note, options)}
    ${renderEditableRelationshipGroup({
      title: "Evidence",
      noteId: note?.id,
      groups: evidenceGroups,
      order: EVIDENCE_ROLE_ORDER,
      labels: EVIDENCE_ROLE_LABELS,
      renderItem: renderEvidenceItem,
      emptyLabel: "No attached evidence yet.",
    })}
    ${renderEditableRelationshipGroup({
      title: "Related notes",
      noteId: note?.id,
      groups: noteLinkGroups,
      order: NOTE_LINK_TYPE_ORDER,
      labels: NOTE_LINK_TYPE_LABELS,
      renderItem: renderRelatedNoteItem,
      emptyLabel: "No related notes yet.",
    })}
    ${detailList("Tags", (note.tags || []).map((tag) => escapeHtml(tag.name || "")), "No tags on this note.")}
  `;
}

function singular(type) {
  return type.endsWith("s") ? type.slice(0, -1) : type;
}

function dedupeRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const id = row?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function noteLinkedCitations(note, citations) {
  const byId = new Map((citations || []).map((citation) => [citation.id, citation]));
  const linked = [];
  if (note?.citation_id && byId.has(note.citation_id)) {
    linked.push(byId.get(note.citation_id));
  }
  for (const source of note?.evidence_links || []) {
    if (source?.citation_id && byId.has(source.citation_id)) {
      linked.push(byId.get(source.citation_id));
    }
  }
  return dedupeRows(linked);
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

export function renderDocumentRelationshipDetail(document, attached = {}, options = {}) {
  const attachedCitations = Array.isArray(attached.citations) ? attached.citations : [];
  const attachedNotes = Array.isArray(attached.notes) ? attached.notes : [];
  const attachedQuotes = Array.isArray(attached.quotes) ? attached.quotes : [];
  const derivedSources = Array.isArray(attached.sources) ? attached.sources : [];
  return `
    <section class="detail-section">
      <p class="section-kicker">Document context</p>
      <h3>${escapeHtml(document?.title || "Current document")}</h3>
      <p class="detail-copy">Attached relationships stay distinct from research derived through those attachments.</p>
      <div class="detail-chip-row">
        <span class="meta-pill">${escapeHtml(document?.status || "active")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(document?.updated_at || document?.created_at))}</span>
      </div>
    </section>
    ${options?.projectAssignment?.supported ? renderProjectAssignmentControl({ entityType: "document", entity: document, projects: options.projectAssignment.projects || [] }) : ""}
    ${renderRelationshipSummary([
      { label: "attached citations", count: attachedCitations.length },
      { label: "attached notes", count: attachedNotes.length },
      { label: "attached quotes", count: attachedQuotes.length },
      { label: "derived sources", count: derivedSources.length },
    ])}
    ${renderEntitySection("Attached citations", "citation", attachedCitations, "No citations attached to this document yet.")}
    ${renderEntitySection("Attached notes", "note", attachedNotes, "No notes attached to this document yet.")}
    ${renderEntitySection("Inserted quotes", "quote", attachedQuotes, "No quotes inserted from attached research yet.")}
    ${renderEntitySection("Derived sources", "source", derivedSources, "No derived sources available yet.")}
  `;
}

export function renderProjectDetail(project) {
  const counts = project?.relationship_counts || {};
  const recentActivity = Array.isArray(project?.recent_activity) ? project.recent_activity : [];
  const derivedVisibility = [
    `Citations referenced through contained notes and documents: ${counts.derived_citation_count || 0}`,
    `Sources referenced through contained notes and documents: ${counts.derived_source_count || 0}`,
  ];
  return `
    <section class="detail-section">
      <p class="section-kicker">Project overview</p>
      <h3>${escapeHtml(project?.name || "Project")}</h3>
      <p class="detail-copy">${escapeHtml(project?.description || "Project visibility is derived from canonical note and document ownership.")}</p>
      <div class="detail-chip-row">
        <span class="project-chip">${escapeHtml(project?.color || "No color")}</span>
        <span class="meta-pill">${escapeHtml(formatDateTime(project?.updated_at || project?.created_at))}</span>
      </div>
    </section>
    <section class="detail-section">
      <p class="section-kicker">Contained work</p>
      <p class="surface-note">Projects directly contain notes and documents only.</p>
    </section>
    ${renderRelationshipSummary([
      { label: "notes", count: counts.note_count },
      { label: "documents", count: counts.document_count },
    ])}
    <section class="detail-section">
      <p class="section-kicker">Derived research visibility</p>
      <p class="surface-note">Research visibility is read through contained work. Projects do not directly own sources, citations, or quotes.</p>
    </section>
    ${renderRelationshipSummary([
      { label: "derived citations", count: counts.derived_citation_count },
      { label: "derived sources", count: counts.derived_source_count },
    ])}
    ${detailList("Derived visibility summary", derivedVisibility.map((item) => escapeHtml(item)), "No derived research visibility yet.")}
    ${detailList(
      "Recent activity",
      recentActivity.map((item) => escapeHtml(`${item?.entity_type || "item"} · ${item?.label || item?.title || "Updated"}`)),
      "No recent project activity yet."
    )}
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
    if (data.evidence_links?.[0]?.source_id) params.set("seed_source_id", data.evidence_links[0].source_id);
  }
  return `/editor?${params.toString()}`;
}

export function renderGraphDetail(graph, options = {}) {
  const node = graph?.node || {};
  const collections = graph?.collections || {};
  const current = node.data || {};
  const sources = (collections.sources || []).filter((item) => !(node.type === "source" && item.id === current.id));
  const citations = (collections.citations || []).filter((item) => !(node.type === "citation" && item.id === current.id));
  const quotes = (collections.quotes || []).filter((item) => !(node.type === "quote" && item.id === current.id));
  const notes = (collections.notes || []).filter((item) => !(node.type === "note" && item.id === current.id));
  const documents = collections.documents || [];
  const noteCitations = node.type === "note" ? noteLinkedCitations(current, collections.citations || []) : [];

  const primarySections = [];
  if (node.type === "source") {
    primarySections.push(renderSourceDetail(current, options?.detailOptions?.source || {}));
    primarySections.push(renderRelationshipSummary([
      { label: "citations", count: citations.length },
      { label: "quotes", count: quotes.length },
      { label: "notes", count: notes.length },
      { label: "documents", count: documents.length },
    ]));
    primarySections.push(renderEntitySection("Citation neighborhood", "citation", citations, "No citations connected to this source yet."));
    primarySections.push(renderEntitySection("Quote neighborhood", "quote", quotes, "No quotes connected to this source yet."));
    primarySections.push(renderEntitySection("Note neighborhood", "note", notes, "No notes connected to this source yet."));
    primarySections.push(renderEntitySection("Document attachments", "document", documents, "No documents use this source yet."));
  } else if (node.type === "citation") {
    primarySections.push(renderCitationDetail(current, {
      citationView: options?.citationViewState?.get?.(current.id) || {},
      ...(options?.detailOptions?.citation || {}),
    }));
    primarySections.push(renderRelationshipSummary([
      { label: "source", count: current.source ? 1 : 0 },
      { label: "quotes", count: quotes.length },
      { label: "notes", count: notes.length },
      { label: "documents", count: documents.length },
    ]));
    primarySections.push(renderEntitySection("Source neighborhood", "source", current.source ? [current.source] : [], "No source linked to this citation."));
    primarySections.push(renderEntitySection("Quote neighborhood", "quote", quotes, "No quotes linked to this citation yet."));
    primarySections.push(renderEntitySection("Note neighborhood", "note", notes, "No notes linked to this citation yet."));
    primarySections.push(renderEntitySection("Document attachments", "document", documents, "No documents use this citation yet."));
  } else if (node.type === "quote") {
    primarySections.push(renderQuoteDetail(current, {
      ...(options?.detailOptions?.quote || {}),
      derivedNotes: notes,
    }));
    primarySections.push(renderRelationshipSummary([
      { label: "source", count: current.citation?.source ? 1 : 0 },
      { label: "citation", count: current.citation ? 1 : 0 },
      { label: "notes", count: notes.length },
      { label: "documents", count: documents.length },
    ]));
    primarySections.push(renderEntitySection("Source neighborhood", "source", current.citation?.source ? [current.citation.source] : [], "No parent source available."));
    primarySections.push(renderEntitySection("Citation neighborhood", "citation", current.citation ? [current.citation] : [], "No citation available."));
    primarySections.push(renderEntitySection("Document attachments", "document", documents, "No documents connected to this quote yet."));
  } else if (node.type === "note") {
    primarySections.push(renderNoteDetail(current, options?.detailOptions?.note || {}));
    primarySections.push(renderRelationshipSummary([
      { label: "sources", count: sources.length },
      { label: "citations", count: noteCitations.length },
      { label: "quotes", count: quotes.length },
      { label: "related notes", count: notes.length },
      { label: "attached documents", count: documents.length },
    ]));
    primarySections.push(renderEntitySection("Source neighborhood", "source", sources, "No linked sources on this note."));
    primarySections.push(renderEntitySection("Citation neighborhood", "citation", noteCitations, "No linked citations on this note."));
    primarySections.push(renderEntitySection("Quote neighborhood", "quote", quotes, "No linked quote on this note."));
    if (!Array.isArray(current?.attached_documents)) {
      primarySections.push(renderEntitySection("Attached documents", "document", documents, "No documents use this note yet."));
    }
  } else {
    primarySections.push(`<section class="detail-section"><h3>${escapeHtml(singular(node.type || "item"))}</h3></section>`);
  }

  primarySections.push(renderWorkflowLink(buildEditorHref(graph)));
  return primarySections.join("");
}
