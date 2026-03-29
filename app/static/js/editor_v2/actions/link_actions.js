import { FEEDBACK_EVENTS } from "../../shared/feedback/feedback_tokens.js";
import { createNoteRelationshipAuthoringController } from "../../shared/note_relationship_authoring.js";

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

export function createLinkActions({ workspaceState, attachActions, feedback = null, researchApi = null, stores = null }) {
  let onChange = null;

  function attachmentState(kind, entityId) {
    const state = workspaceState.getState();
    const activeDocument = summarizeDocument(state.active_document);
    if (!activeDocument || !entityId) {
      return {
        activeDocument,
        linkedDocuments: [],
        attachAction: null,
      };
    }
    const collectionKey = `${kind}s`;
    const stateKey = `${kind}:${entityId}`;
    const attached = !!(state.attached_relation_ids?.[collectionKey] || []).includes(entityId);
    const activity = state.runtime_activity?.attachments?.[stateKey] || null;
    const failure = state.runtime_failures?.attachments?.[stateKey] || null;
    const pending = activity?.phase === "running";
    const removing = pending && activity?.mode === "detach";
    return {
      activeDocument,
      linkedDocuments: attached ? [activeDocument] : [],
      attachAction: {
        supported: true,
        attached,
        pending,
        failed: !!failure,
        failureMessage: failure?.message || "",
        statusLabel: pending
          ? (removing ? "Removing…" : "Attaching…")
          : (attached ? "Attached" : (failure ? "Failed" : "Not attached")),
        label: pending
          ? (removing ? "Removing attachment…" : "Attaching…")
          : (attached ? "Attached to current document" : "Attach to current document"),
        removeLabel: pending && removing ? "Removing attachment…" : "Remove attachment",
        canDetach: attached,
        documentTitle: activeDocument.title,
      },
    };
  }

  function emitAttachFailure(eventName, payload) {
    feedback?.emitDomainEvent?.(eventName, payload);
  }

  async function runAttachAction(action, permissionMessage, failureTitle, failureMessage, dedupeKey) {
    try {
      return await action();
    } catch (error) {
      if (error?.status === 403) {
        emitAttachFailure(FEEDBACK_EVENTS.PERMISSION_DENIED, {
          message: error?.message || permissionMessage,
          dedupeKey,
        });
        return null;
      }
      emitAttachFailure(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
        title: failureTitle,
        message: error?.message || failureMessage,
      });
      throw error;
    }
  }

  const relationshipAuthoring = researchApi
    ? createNoteRelationshipAuthoringController({
      api: researchApi,
      getNoteDetail(noteId) {
        return stores?.notes?.get?.(noteId) || researchApi.getNote(noteId);
      },
      onStateChange() {
        onChange?.();
      },
      async onNavigateToNote(noteId) {
        workspaceState.setFocusedEntity({ type: "note", id: noteId });
      },
      async onNoteUpdated(note) {
        stores?.notes?.prime?.([note]);
        onChange?.();
      },
      onNotify(event) {
        if (event?.kind === "success") {
          feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.RESEARCH_PANEL_READY, { label: event.message || "Relationship saved" });
          return;
        }
        feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
          title: "Relationship update failed",
          message: event?.message || "The relationship update failed.",
        });
      },
    })
    : null;

  return {
    setOnChange(nextOnChange) {
      onChange = typeof nextOnChange === "function" ? nextOnChange : null;
    },
    getCitationDetailOptions(citation) {
      const linkState = attachmentState("citation", citation?.id);
      return {
        documents: linkState.linkedDocuments,
        attachAction: linkState.attachAction,
        ...(relationshipAuthoring?.getCitationDetailOptions?.(citation) || {}),
      };
    },
    getNoteDetailOptions(note) {
      const linkState = attachmentState("note", note?.id);
      return {
        documents: linkState.linkedDocuments,
        attachAction: linkState.attachAction,
        ...(relationshipAuthoring?.getNoteDetailOptions?.(note) || {}),
      };
    },
    getSourceDetailOptions(source) {
      return relationshipAuthoring?.getSourceDetailOptions?.(source) || {};
    },
    handleRelationshipChange(dataset, value) {
      relationshipAuthoring?.handleChange?.(dataset, value);
    },
    async handleRelationshipAction(dataset) {
      return relationshipAuthoring?.handleClick?.(dataset);
    },
    async attachNoteToCurrentDocument(noteId) {
      return runAttachAction(
        () => attachActions.attachNote(noteId, { source: "attach" }),
        "You cannot attach that note to this document.",
        "Note attach failed",
        "The note could not be attached to this document.",
        "note-attach-permission-denied",
      );
    },
    async detachNoteFromCurrentDocument(noteId) {
      return runAttachAction(
        () => attachActions.detachNote(noteId, { source: "detach" }),
        "You cannot remove that note from this document.",
        "Note removal failed",
        "The note could not be removed from this document.",
        "note-detach-permission-denied",
      );
    },
    async attachCitationToCurrentDocument(citationId) {
      return runAttachAction(
        () => attachActions.attachCitation(citationId, { source: "attach" }),
        "You cannot attach that citation to this document.",
        "Citation attach failed",
        "The citation could not be attached to this document.",
        "citation-attach-permission-denied",
      );
    },
    async detachCitationFromCurrentDocument(citationId) {
      return runAttachAction(
        () => attachActions.detachCitation(citationId, { source: "detach" }),
        "You cannot remove that citation from this document.",
        "Citation removal failed",
        "The citation could not be removed from this document.",
        "citation-detach-permission-denied",
      );
    },
    supportsEntityAttach(entityType) {
      return entityType === "note" || entityType === "citation";
    },
  };
}
