export function createAutosaveController({ workspaceState, workspaceApi, eventBus }) {
  let timer = null;
  let disposed = false;
  let requestSeq = 0;
  let latestApplied = 0;
  let retryCount = 0;
  const maxRetries = 2;

  function clearTimer() {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  async function persistNow() {
    const state = workspaceState.getState();
    if (disposed || !state.active_document_id || !state.dirty || !state.active_document) return;
    requestSeq += 1;
    const currentSeq = requestSeq;
    workspaceState.setSaveStatus("saving");
    eventBus.emit("doc.save.started", { documentId: state.active_document_id });
    try {
      const document = await workspaceApi.updateDocument(state.active_document_id, {
        title: state.active_document.title,
        content_delta: state.active_document.content_delta,
        content_html: state.active_document.content_html,
        project_id: state.active_document.project_id || null,
      });
      if (currentSeq < latestApplied) return;
      latestApplied = currentSeq;
      retryCount = 0;
      workspaceState.markSavedFromServer(document);
      eventBus.emit("doc.save.succeeded", { documentId: state.active_document_id });
    } catch (error) {
      if (currentSeq < latestApplied) return;
      retryCount += 1;
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      workspaceState.setSaveStatus(offline ? "offline" : "error");
      eventBus.emit("doc.save.failed", { documentId: state.active_document_id, error, offline });
      if (retryCount <= maxRetries && !offline) {
        timer = window.setTimeout(() => void persistNow(), 1500 * retryCount);
      }
    }
  }

  function schedule() {
    clearTimer();
    timer = window.setTimeout(() => void persistNow(), 650);
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
      await persistNow();
    },
    dispose() {
      disposed = true;
      clearTimer();
      window.removeEventListener("beforeunload", onBeforeUnload);
    },
  };
}
