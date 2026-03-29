import { citationPrimaryText } from "../../shared/citation_contract.js";

function insertionIndex(quillAdapter) {
  const range = quillAdapter.getSelection();
  if (range) return range.index;
  return Math.max(quillAdapter.getText().length - 1, 0);
}

export function createInsertActions({ quillAdapter, attachActions, workspaceState, eventBus }) {
  return {
    async insertCitation(citation) {
      const index = insertionIndex(quillAdapter);
      quillAdapter.insertCitationChip({
        citationId: citation.id,
        sourceId: citation.source?.id || citation.source_id || "",
        label: citationPrimaryText(citation, "Citation"),
        index,
      });
      await attachActions.attachCitation(citation.id, { source: "insert" });
      workspaceState.setFocusedEntity({ type: "citation", id: citation.id });
    },
    async insertNote(note) {
      const index = insertionIndex(quillAdapter);
      quillAdapter.insertNoteMarker({
        noteId: note.id,
        label: note.title || "Note",
        index,
      });
      await attachActions.attachNote(note.id, { source: "insert" });
      workspaceState.setFocusedEntity({ type: "note", id: note.id });
    },
    async insertQuote(quote) {
      const index = insertionIndex(quillAdapter);
      quillAdapter.insertQuoteBlock({
        quoteId: quote.id,
        citationId: quote.citation?.id || quote.citation_id || "",
        text: quote.excerpt || "",
        index,
      });
      const citationId = quote.citation?.id || quote.citation_id;
      if (citationId) {
        await attachActions.attachCitation(citationId, { source: "insert" });
      }
      workspaceState.setFocusedEntity({ type: "quote", id: quote.id });
      eventBus?.emit("quote.inserted", { quoteId: quote.id, citationId, source: "insert" });
    },
    insertBibliography(citations) {
      if (!citations.length) return;
      const unique = Array.from(new Map(citations.map((citation) => [citation.id, citation])).values());
      const index = insertionIndex(quillAdapter);
      const lines = ["\nBibliography\n", ...unique.map((citation) => `${citationPrimaryText(citation, citation.id)}\n`)];
      quillAdapter.insertText(index, lines.join(""));
      eventBus?.emit("bibliography.inserted", { count: unique.length });
    },
  };
}
