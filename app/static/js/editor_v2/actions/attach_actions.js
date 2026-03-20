import { getWorkspaceConflictSnapshot, isWorkspaceConflictError } from "../core/workspace_conflicts.js";

export function createAttachActions({ workspaceState, workspaceApi, eventBus }) {
  async function handleConflict({ error, state, source }) {
    if (!isWorkspaceConflictError(error)) throw error;
    const conflict = getWorkspaceConflictSnapshot(error);
    workspaceState.setSaveStatus("conflict");
    workspaceState.setDocumentConflict({
      ...conflict,
      documentId: state.active_document_id,
      source,
    });
    eventBus?.emit("doc.save.conflict", {
      documentId: state.active_document_id,
      error,
      conflict,
    });
    throw error;
  }

  return {
    async attachCitation(citationId) {
      const state = workspaceState.getState();
      const current = state.attached_relation_ids.citations || [];
      if (!state.active_document_id) return state.active_document;
      if (current.includes(citationId)) {
        eventBus?.emit("citation.attach_skipped", { citationId });
        return state.active_document;
      }
      try {
        const document = await workspaceApi.replaceDocumentCitations(
          state.active_document_id,
          state.active_document.revision || state.active_document.updated_at,
          [...current, citationId],
        );
        workspaceState.markSavedFromServer(document);
        eventBus?.emit("citation.attached", { citationId, documentId: state.active_document_id });
        return document;
      } catch (error) {
        await handleConflict({ error, state, source: "attach_citation" });
      }
    },
    async attachNote(noteId) {
      const state = workspaceState.getState();
      const current = state.attached_relation_ids.notes || [];
      if (!state.active_document_id) return state.active_document;
      if (current.includes(noteId)) {
        eventBus?.emit("note.attach_skipped", { noteId });
        return state.active_document;
      }
      try {
        const document = await workspaceApi.replaceDocumentNotes(
          state.active_document_id,
          state.active_document.revision || state.active_document.updated_at,
          [...current, noteId],
        );
        workspaceState.markSavedFromServer(document);
        eventBus?.emit("note.attached", { noteId, documentId: state.active_document_id });
        return document;
      } catch (error) {
        await handleConflict({ error, state, source: "attach_note" });
      }
    },
  };
}
