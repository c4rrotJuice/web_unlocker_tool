import { FEEDBACK_EVENTS } from "../../shared/feedback/feedback_tokens.js";
import { convertQuoteToNote as runQuoteToNoteConversion } from "../../shared/quote_note_conversion.js";

export function createConvertActions({
  researchApi,
  attachActions,
  insertActions,
  workspaceState,
  eventBus,
  stores,
  feedback,
}) {
  return {
    getQuoteDetailOptions(quote) {
      return {
        convertAction: {
          supported: !!quote?.id,
          label: "Convert to note",
        },
        derivedNotes: quote?.neighborhood?.notes || [],
      };
    },
    getNoteDetailOptions(note) {
      return {
        insertAction: {
          supported: !!note?.id,
          label: "Insert note",
        },
      };
    },
    async convertQuoteToNote(quote) {
      const state = workspaceState.getState();
      const result = await runQuoteToNoteConversion({
        quote,
        researchApi,
        stores,
        projectId: state.active_project_id || null,
        feedback,
      });
      if (!result?.note) return null;

      workspaceState.setFocusedEntity({ type: "note", id: result.note.id });
      workspaceState.setSeedState(state.seed_state ? { ...state.seed_state, mode: "idle" } : null);
      eventBus?.emit("note.created", {
        noteId: result.note.id,
        quoteId: quote?.id || null,
        source: "quote_conversion",
      });

      try {
        await attachActions.attachNote(result.note.id, { source: "convert" });
      } catch (error) {
        if (error?.status === 403) {
          feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.PERMISSION_DENIED, {
            message: error?.message || "You cannot attach that note to this document.",
            dedupeKey: "note-attach-permission-denied",
          });
          return result.note;
        }
        feedback?.emitDomainEvent?.(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
          title: "Note attach failed",
          message: error?.message || "The note was created but could not be attached to this document.",
        });
      }
      return result.note;
    },
    async insertNote(note) {
      if (!note?.id) return null;
      await insertActions.insertNote(note);
      return note;
    },
  };
}
