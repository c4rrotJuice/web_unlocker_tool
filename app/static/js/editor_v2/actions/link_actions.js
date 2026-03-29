import { FEEDBACK_EVENTS } from "../../shared/feedback/feedback_tokens.js";

function summarizeDocument(document) {
  if (!document?.id) return null;
  return {
    id: document.id,
    title: document.title || "Untitled document",
    status: document.status || "active",
    attached_citation_ids: Array.isArray(document.attached_citation_ids) ? document.attached_citation_ids.slice() : [],
    attached_note_ids: Array.isArray(document.attached_note_ids) ? document.attached_note_ids.slice() : [],
    tags: Array.isArray(document.tags) ? document.tags.slice() : [],
    created_at: document.created_at || null,
    updated_at: document.updated_at || document.revision || null,
  };
}

export function createLinkActions({ workspaceState, attachActions, feedback = null }) {
  function noteDocumentLinkState(note) {
    const state = workspaceState.getState();
    const activeDocument = summarizeDocument(state.active_document);
    const attachedToActiveDocument = !!(note?.id && (state.attached_relation_ids?.notes || []).includes(note.id));
    return {
      activeDocument,
      linkedDocuments: attachedToActiveDocument && activeDocument ? [activeDocument] : [],
      attachAction: activeDocument
        ? {
          supported: true,
          attached: attachedToActiveDocument,
          label: attachedToActiveDocument ? "Attached to current document" : "Attach to current document",
          documentTitle: activeDocument.title,
        }
        : null,
    };
  }

  return {
    getNoteDetailOptions(note) {
      const linkState = noteDocumentLinkState(note);
      return {
        documents: linkState.linkedDocuments,
        attachAction: linkState.attachAction,
      };
    },
    async attachNoteToCurrentDocument(noteId) {
      try {
        return await attachActions.attachNote(noteId);
      } catch (error) {
        if (error?.status === 403) {
          feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.PERMISSION_DENIED, {
            message: error?.message || "You cannot attach that note to this document.",
            dedupeKey: "note-attach-permission-denied",
          });
          return null;
        }
        feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
          title: "Note attach failed",
          message: error?.message || "The note could not be attached to this document.",
        });
        throw error;
      }
    },
    supportsEntityAttach(entityType) {
      return entityType === "note";
    },
  };
}
