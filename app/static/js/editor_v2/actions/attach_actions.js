export function createAttachActions({ workspaceState, workspaceApi, eventBus }) {
  return {
    async attachCitation(citationId) {
      const state = workspaceState.getState();
      const current = state.attached_relation_ids.citations || [];
      if (!state.active_document_id) return state.active_document;
      if (current.includes(citationId)) {
        eventBus?.emit("citation.attach_skipped", { citationId });
        return state.active_document;
      }
      const document = await workspaceApi.replaceDocumentCitations(state.active_document_id, [...current, citationId]);
      workspaceState.markSavedFromServer(document);
      eventBus?.emit("citation.attached", { citationId, documentId: state.active_document_id });
      return document;
    },
    async attachNote(noteId) {
      const state = workspaceState.getState();
      const current = state.attached_relation_ids.notes || [];
      if (!state.active_document_id) return state.active_document;
      if (current.includes(noteId)) {
        eventBus?.emit("note.attach_skipped", { noteId });
        return state.active_document;
      }
      const document = await workspaceApi.replaceDocumentNotes(state.active_document_id, [...current, noteId]);
      workspaceState.markSavedFromServer(document);
      eventBus?.emit("note.attached", { noteId, documentId: state.active_document_id });
      return document;
    },
  };
}
