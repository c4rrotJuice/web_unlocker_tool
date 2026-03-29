function buildNoteTitle(text, fallback = "Working note") {
  const normalized = String(text || "").trim().replace(/\s+/g, " ");
  if (!normalized) return fallback;
  return normalized.slice(0, 72);
}

export function createNoteActions({ researchApi, attachActions, workspaceState, eventBus, stores, convertActions = null }) {
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
      return convertActions?.convertQuoteToNote?.(quote) || null;
    },
  };
}
