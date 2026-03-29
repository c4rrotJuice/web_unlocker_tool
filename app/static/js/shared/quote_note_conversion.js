import { FEEDBACK_EVENTS } from "./feedback/feedback_tokens.js";

function buildNoteTitle(text, fallback = "Quote note") {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return fallback;
  return normalized.slice(0, 72);
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

export function buildQuoteToNoteRequest(quote, { projectId = null } = {}) {
  const noteBody = String(quote?.excerpt || "").trim() || "Quote note";
  return {
    title: buildNoteTitle(noteBody, "Quote note"),
    note_body: noteBody,
    project_id: projectId || null,
  };
}

export function mergeConvertedNoteIntoQuote(quote, note) {
  if (!quote?.id || !note?.id) return quote;
  const nextNoteIds = Array.isArray(quote.note_ids) ? quote.note_ids.slice() : [];
  if (!nextNoteIds.includes(note.id)) {
    nextNoteIds.push(note.id);
  }
  const neighborhoodNotes = dedupeRows([...(quote?.neighborhood?.notes || []), note]);
  return {
    ...quote,
    note_ids: nextNoteIds,
    neighborhood: {
      ...(quote?.neighborhood || {}),
      notes: neighborhoodNotes,
    },
  };
}

export async function convertQuoteToNote({
  quote,
  researchApi,
  stores = null,
  projectId = null,
  feedback = null,
}) {
  if (!quote?.id) return null;
  try {
    const note = await researchApi.createNoteFromQuote(
      quote.id,
      buildQuoteToNoteRequest(quote, { projectId }),
    );
    const nextQuote = mergeConvertedNoteIntoQuote(quote, note);
    stores?.notes?.prime?.([note]);
    stores?.quotes?.prime?.([nextQuote]);
    feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.RESEARCH_PANEL_READY, { label: "Quote converted to note" });
    feedback?.toast?.success?.("Quote converted to note", {
      dedupeKey: `quote-to-note:${quote.id}:${note.id}`,
    });
    return { note, quote: nextQuote };
  } catch (error) {
    if (error?.status === 403) {
      feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.PERMISSION_DENIED, {
        title: "Quote conversion not allowed",
        message: error?.message || "You cannot convert that quote to a note.",
        dedupeKey: `quote-to-note-permission-denied:${quote.id}`,
      });
      return null;
    }
    feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
      title: "Quote conversion failed",
      message: error?.message || "The quote could not be converted to a note.",
    });
    return null;
  }
}
