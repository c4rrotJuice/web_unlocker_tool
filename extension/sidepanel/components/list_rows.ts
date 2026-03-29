function normalizeText(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value: any, maxLength = 120) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function getDomain(urlLike: string) {
  try {
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function createBaseRow(documentRef, attrs = {}) {
  const root = documentRef.createElement("button");
  root.type = "button";
  Object.entries(attrs).forEach(([name, value]) => root.setAttribute(name, String(value)));
  root.style.display = "grid";
  root.style.gap = "6px";
  root.style.width = "100%";
  root.style.padding = "12px 14px";
  root.style.borderRadius = "14px";
  root.style.border = "1px solid rgba(148, 163, 184, 0.14)";
  root.style.background = "rgba(15, 23, 42, 0.62)";
  root.style.textAlign = "left";
  root.style.cursor = "pointer";
  root.style.minHeight = "58px";
  root.style.alignContent = "start";
  return root;
}

function addLine(documentRef, text, styles = {}) {
  const line = documentRef.createElement("div");
  line.textContent = text;
  Object.assign(line.style, styles);
  return line;
}

export function summarizeCitation(citation: any = {}) {
  const source = citation.source || {};
  const authors = Array.isArray(source.authors)
    ? source.authors.map((author) => normalizeText(author?.fullName)).filter(Boolean).slice(0, 2).join(", ")
    : "";
  const issued = normalizeText(source?.issued_date?.raw || source?.issued_date?.year || "");
  const preview = citation.quote_text || citation.excerpt || citation.renders?.apa?.bibliography || "";
  return {
    title: truncate(source.title || preview || "Citation", 82),
    meta: [authors, issued, getDomain(source.url || citation.page_url || ""), normalizeText(source.source_type).replace(/_/g, " ")].filter(Boolean).join(" • "),
    body: preview || "Citation preview unavailable.",
  };
}

export function summarizeNote(note: any = {}) {
  const preview = normalizeText(note.note_body || note.highlight_text || "");
  return {
    title: truncate(note.title || preview || "Untitled note", 82),
    meta: [note.highlight_text ? "Highlight note" : "Plain note", getDomain(note.page_url || note.source?.url || ""), normalizeText(note.created_at).slice(0, 10)].filter(Boolean).join(" • "),
    body: preview || "Note preview unavailable.",
  };
}

export function summarizeDocument(documentItem: any = {}) {
  return {
    title: truncate(documentItem.title || "Document", 82),
    meta: [normalizeText(documentItem.status), normalizeText(documentItem.updated_at).slice(0, 10)].filter(Boolean).join(" • "),
    body: normalizeText(documentItem.summary || documentItem.preview || "Document preview unavailable."),
  };
}

export function summarizeQuote(quote: any = {}) {
  return {
    title: truncate(quote.title || quote.excerpt || "Quote", 82),
    meta: [normalizeText(quote.locator?.page ? `p. ${quote.locator.page}` : ""), normalizeText(quote.created_at).slice(0, 10), getDomain(quote.page_url || quote.source?.url || "")].filter(Boolean).join(" • "),
    body: normalizeText(quote.excerpt || quote.annotation || "Quote preview unavailable."),
  };
}

export function createCitationListRow({ documentRef = globalThis.document, citation }: any = {}) {
  const summary = summarizeCitation(citation);
  const root = createBaseRow(documentRef, { "data-citation-id": citation?.id || "" });
  root.append(
    addLine(documentRef, summary.title, { fontSize: "13px", fontWeight: "600", lineHeight: "1.45", color: "#f8fafc" }),
    addLine(documentRef, summary.meta, { fontSize: "11px", lineHeight: "1.5", color: "#94a3b8" }),
  );
  return { root, summary };
}

export function createNoteListRow({ documentRef = globalThis.document, note }: any = {}) {
  const summary = summarizeNote(note);
  const root = createBaseRow(documentRef, { "data-note-id": note?.id || "" });
  root.append(
    addLine(documentRef, summary.title, { fontSize: "13px", fontWeight: "600", lineHeight: "1.45", color: "#f8fafc" }),
    addLine(documentRef, summary.meta, { fontSize: "11px", lineHeight: "1.5", color: "#94a3b8" }),
  );
  return { root, summary };
}

export function createDocumentListRow({ documentRef = globalThis.document, documentItem }: any = {}) {
  const summary = summarizeDocument(documentItem);
  const root = createBaseRow(documentRef, { "data-document-id": documentItem?.id || "" });
  root.append(
    addLine(documentRef, summary.title, { fontSize: "13px", fontWeight: "600", lineHeight: "1.45", color: "#f8fafc" }),
    addLine(documentRef, summary.meta, { fontSize: "11px", lineHeight: "1.5", color: "#94a3b8" }),
  );
  return { root, summary };
}

export function createQuoteListRow({ documentRef = globalThis.document, quote }: any = {}) {
  const summary = summarizeQuote(quote);
  const root = createBaseRow(documentRef, { "data-quote-id": quote?.id || "" });
  root.append(
    addLine(documentRef, summary.title, { fontSize: "13px", fontWeight: "600", lineHeight: "1.45", color: "#f8fafc" }),
    addLine(documentRef, summary.meta, { fontSize: "11px", lineHeight: "1.5", color: "#94a3b8" }),
  );
  return { root, summary };
}
