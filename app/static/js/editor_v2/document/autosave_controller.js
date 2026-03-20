import { withTimeout } from "../core/async_operation.js";
import { isAuthSessionError } from "../../shared/auth/session.js";

export function createAutosaveController({ workspaceState, workspaceApi, eventBus }) {
  let timer = null;
  let disposed = false;
  let requestSeq = 0;
  let latestApplied = 0;
  let retryCount = 0;
  let inFlight = null;
  const maxRetries = 2;

  function clearTimer() {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  async function persistNow({ allowRetry = true } = {}) {
    const state = workspaceState.getState();
    if (disposed || !state.active_document_id || !state.dirty || !state.active_document) return state.active_document;
    if (inFlight) return inFlight;
    requestSeq += 1;
    const currentSeq = requestSeq;
    workspaceState.setSaveStatus("saving");
    workspaceState.setSaveActivity({ phase: "running", sequence: currentSeq, message: null });
    eventBus.emit("doc.save.started", { documentId: state.active_document_id });
    inFlight = (async () => {
      try {
        const document = await withTimeout(
          workspaceApi.updateDocument(state.active_document_id, {
            title: state.active_document.title,
            content_delta: state.active_document.content_delta,
            content_html: state.active_document.content_html,
            project_id: state.active_document.project_id || null,
          }),
          { label: "Save" },
        );
        if (currentSeq < latestApplied) return document;
        latestApplied = currentSeq;
        retryCount = 0;
        workspaceState.markSavedFromServer(document);
        workspaceState.setSaveActivity({ phase: "idle", sequence: currentSeq, message: null });
        eventBus.emit("doc.save.succeeded", { documentId: state.active_document_id });
        return document;
      } catch (error) {
        if (currentSeq < latestApplied) return workspaceState.getState().active_document;
        retryCount += 1;
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        const authLost = isAuthSessionError(error);
        workspaceState.setSaveStatus(offline ? "offline" : "error");
        if (authLost) {
          workspaceState.setSessionFailure({
            code: error?.code || "missing_credentials",
            label: "Session expired",
            message: error?.message || "Session expired. Sign in again to resume saving.",
          });
        }
        workspaceState.setSaveActivity({
          phase: "error",
          sequence: currentSeq,
          message: error?.message || "Save failed",
        });
        eventBus.emit("doc.save.failed", { documentId: state.active_document_id, error, offline });
        if (allowRetry && retryCount <= maxRetries && !offline && !authLost) {
          timer = window.setTimeout(() => {
            void persistNow({ allowRetry: true }).catch(() => {});
          }, 1500 * retryCount);
        }
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function schedule() {
    clearTimer();
    timer = window.setTimeout(() => {
      void persistNow({ allowRetry: true }).catch(() => {});
    }, 650);
  }

  function onBeforeUnload(event) {
    const state = workspaceState.getState();
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  }

  window.addEventListener("beforeunload", onBeforeUnload);

  return {
    schedule,
    async flush() {
      clearTimer();
      const flushSeq = workspaceState.getState().runtime_activity.flush.sequence + 1;
      workspaceState.setFlushActivity({ phase: "running", sequence: flushSeq, message: null });
      eventBus.emit("doc.flush.started", {
        documentId: workspaceState.getState().active_document_id,
        sequence: flushSeq,
      });
      if (inFlight) {
        try {
          await withTimeout(inFlight, { label: "Flush" });
        } catch (error) {
          workspaceState.setFlushActivity({ phase: "error", sequence: flushSeq, message: error?.message || "Flush failed" });
          eventBus.emit("doc.flush.failed", {
            documentId: workspaceState.getState().active_document_id,
            sequence: flushSeq,
            error,
          });
          throw error;
        }
      }
      try {
        const result = await withTimeout(Promise.resolve(persistNow({ allowRetry: false })), { label: "Flush" });
        workspaceState.setFlushActivity({ phase: "idle", sequence: flushSeq, message: null });
        eventBus.emit("doc.flush.succeeded", {
          documentId: workspaceState.getState().active_document_id,
          sequence: flushSeq,
        });
        return result;
      } catch (error) {
        workspaceState.setFlushActivity({ phase: "error", sequence: flushSeq, message: error?.message || "Flush failed" });
        eventBus.emit("doc.flush.failed", {
          documentId: workspaceState.getState().active_document_id,
          sequence: flushSeq,
          error,
        });
        throw error;
      }
    },
    dispose() {
      disposed = true;
      clearTimer();
      window.removeEventListener("beforeunload", onBeforeUnload);
    },
  };
}
