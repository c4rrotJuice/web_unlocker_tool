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
    eventBus.emit("doc.save.started", { documentId: state.active_document_id });
    inFlight = (async () => {
      try {
        const document = await workspaceApi.updateDocument(state.active_document_id, {
          title: state.active_document.title,
          content_delta: state.active_document.content_delta,
          content_html: state.active_document.content_html,
          project_id: state.active_document.project_id || null,
        });
        if (currentSeq < latestApplied) return document;
        latestApplied = currentSeq;
        retryCount = 0;
        workspaceState.markSavedFromServer(document);
        eventBus.emit("doc.save.succeeded", { documentId: state.active_document_id });
        return document;
      } catch (error) {
        if (currentSeq < latestApplied) return workspaceState.getState().active_document;
        retryCount += 1;
        const offline = typeof navigator !== "undefined" && navigator.onLine === false;
        workspaceState.setSaveStatus(offline ? "offline" : "error");
        eventBus.emit("doc.save.failed", { documentId: state.active_document_id, error, offline });
        if (allowRetry && retryCount <= maxRetries && !offline) {
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
      if (inFlight) {
        await inFlight;
      }
      return persistNow({ allowRetry: false });
    },
    dispose() {
      disposed = true;
      clearTimer();
      window.removeEventListener("beforeunload", onBeforeUnload);
    },
  };
}
