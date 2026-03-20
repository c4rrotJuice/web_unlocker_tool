function buildNoteTitle(text, fallback = "Working note") {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return fallback;
  return normalized.slice(0, 72);
}

export function createNoteActions({ researchApi, attachActions, workspaceState, eventBus, stores }) {
  return {
    async createNoteFromSelection(selectionText) {
      const state = workspaceState.getState();
      const normalizedText = String(selectionText || "").trim();
      if (!normalizedText) return null;
      const note = await researchApi.createNote({
        title: buildNoteTitle(normalizedText, "Selection note"),
        note_body: normalizedText,
        highlight_text: normalizedText,
        project_id: state.active_project_id || null,
      });
      stores?.notes?.prime?.([note]);
      await attachActions.attachNote(note.id);
      workspaceState.setFocusedEntity({ type: "note", id: note.id });
      eventBus?.emit("note.created", { noteId: note.id, source: "selection" });
      return note;
    },
    async createNoteFromQuote(quote) {
      if (!quote?.id) return null;
      const state = workspaceState.getState();
      const noteBody = String(quote.excerpt || "").trim() || "Quote note";
      const note = await researchApi.createNoteFromQuote(quote.id, {
        title: buildNoteTitle(noteBody, "Quote note"),
        note_body: noteBody,
        project_id: state.active_project_id || null,
      });
      stores?.notes?.prime?.([note]);
      await attachActions.attachNote(note.id);
      workspaceState.setFocusedEntity({ type: "note", id: note.id });
      eventBus?.emit("note.created", { noteId: note.id, quoteId: quote.id, source: "quote" });
      return note;
    },
  };
}
