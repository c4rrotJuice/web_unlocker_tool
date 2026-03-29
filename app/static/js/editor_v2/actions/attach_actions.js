import { getWorkspaceConflictSnapshot, isWorkspaceConflictError } from "../core/workspace_conflicts.js";

export function createAttachActions({ workspaceState, workspaceApi, eventBus, hydrator = null }) {
  let attachmentSequence = 0;

  function nextSequence() {
    attachmentSequence += 1;
    return attachmentSequence;
  }

  function stateKey(kind, id) {
    return `${kind}:${id}`;
  }

  async function refreshAttachedResearch(documentId, seed) {
    if (!documentId || !workspaceApi?.hydrateDocument) return;
    const payload = await workspaceApi.hydrateDocument(documentId, seed || null);
    if (hydrator?.consumeDocumentHydration) {
      hydrator.consumeDocumentHydration(payload);
    } else {
      workspaceState.setAttachedResearch({
        citations: Array.isArray(payload?.attached_citations) ? payload.attached_citations : [],
        notes: Array.isArray(payload?.attached_notes) ? payload.attached_notes : [],
        quotes: Array.isArray(payload?.attached_quotes) ? payload.attached_quotes : [],
        sources: Array.isArray(payload?.derived_sources) ? payload.derived_sources : [],
      });
    }
    workspaceState.setHydrationFlag("attached_ready", true);
  }

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

  async function replaceAttachment(kind, entityId, {
    relationIds,
    rpc,
    attachEvent,
    detachEvent,
    skippedEvent,
    source = "attach",
    mode = "attach",
  }) {
    const state = workspaceState.getState();
    if (!state.active_document_id) return state.active_document;
    const key = stateKey(kind, entityId);
    const current = relationIds || [];
    const alreadyAttached = current.includes(entityId);
    const removing = mode === "detach";
    if (!entityId) return state.active_document;
    if (!removing && alreadyAttached) {
      eventBus?.emit(skippedEvent, { [`${kind}Id`]: entityId, documentId: state.active_document_id, source });
      return state.active_document;
    }
    if (removing && !alreadyAttached) {
      return state.active_document;
    }

    const nextIds = removing
      ? current.filter((id) => id !== entityId)
      : [...current, entityId];
    const sequence = nextSequence();
    workspaceState.setAttachmentFailure(kind, entityId, null);
    workspaceState.setAttachmentActivity(kind, entityId, {
      phase: "running",
      sequence,
      message: removing ? "Removing attachment…" : "Attaching…",
      mode,
    });
    try {
      const document = await rpc(
        state.active_document_id,
        state.active_document.revision || state.active_document.updated_at,
        nextIds,
      );
      workspaceState.markSavedFromServer(document);
      try {
        await refreshAttachedResearch(state.active_document_id, state.seed_state);
      } catch (refreshError) {
        workspaceState.setDocumentHydrateFailure({
          documentId: state.active_document_id,
          message: refreshError?.message || "Document research context could not be loaded.",
        });
      }
      workspaceState.setAttachmentActivity(kind, entityId, {
        phase: "idle",
        sequence,
        message: null,
        mode,
      });
      eventBus?.emit(removing ? detachEvent : attachEvent, {
        [`${kind}Id`]: entityId,
        documentId: state.active_document_id,
        source,
      });
      return document;
    } catch (error) {
      workspaceState.setAttachmentActivity(kind, entityId, {
        phase: "error",
        sequence,
        message: error?.message || (removing ? "Attachment removal failed." : "Attachment failed."),
        mode,
      });
      workspaceState.setAttachmentFailure(kind, entityId, {
        message: error?.message || (removing ? "Attachment removal failed." : "Attachment failed."),
        mode,
      });
      try {
        await handleConflict({ error, state, source: removing ? `detach_${kind}` : `attach_${kind}` });
      } catch (conflictError) {
        throw conflictError;
      }
      throw error;
    }
  }

  return {
    async attachCitation(citationId, options = {}) {
      const state = workspaceState.getState();
      return replaceAttachment("citation", citationId, {
        relationIds: state.attached_relation_ids.citations || [],
        rpc: workspaceApi.replaceDocumentCitations,
        attachEvent: "citation.attached",
        detachEvent: "citation.detached",
        skippedEvent: "citation.attach_skipped",
        source: options.source || "attach",
        mode: "attach",
      });
    },
    async detachCitation(citationId, options = {}) {
      const state = workspaceState.getState();
      return replaceAttachment("citation", citationId, {
        relationIds: state.attached_relation_ids.citations || [],
        rpc: workspaceApi.replaceDocumentCitations,
        attachEvent: "citation.attached",
        detachEvent: "citation.detached",
        skippedEvent: "citation.attach_skipped",
        source: options.source || "detach",
        mode: "detach",
      });
    },
    async attachNote(noteId, options = {}) {
      const state = workspaceState.getState();
      return replaceAttachment("note", noteId, {
        relationIds: state.attached_relation_ids.notes || [],
        rpc: workspaceApi.replaceDocumentNotes,
        attachEvent: "note.attached",
        detachEvent: "note.detached",
        skippedEvent: "note.attach_skipped",
        source: options.source || "attach",
        mode: "attach",
      });
    },
    async detachNote(noteId, options = {}) {
      const state = workspaceState.getState();
      return replaceAttachment("note", noteId, {
        relationIds: state.attached_relation_ids.notes || [],
        rpc: workspaceApi.replaceDocumentNotes,
        attachEvent: "note.attached",
        detachEvent: "note.detached",
        skippedEvent: "note.attach_skipped",
        source: options.source || "detach",
        mode: "detach",
      });
    },
  };
}
