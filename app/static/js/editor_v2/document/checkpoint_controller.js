export function createCheckpointController({ workspaceState, workspaceApi, refs, eventBus }) {
  async function refresh() {
    const documentId = workspaceState.getState().active_document_id;
    if (!documentId) {
      refs.checkpointsList.innerHTML = `<div class="editor-v2-card">No active document.</div>`;
      return;
    }
    const checkpoints = await workspaceApi.listCheckpoints(documentId);
    refs.checkpointsList.innerHTML = checkpoints.length
      ? checkpoints.map((item) => `
        <button class="editor-v2-checkpoint-item" type="button" data-checkpoint-id="${item.id}">
          <strong>${item.label || "Checkpoint"}</strong>
          <div class="editor-v2-meta">${item.created_at || ""}</div>
        </button>
      `).join("")
      : `<div class="editor-v2-card">No checkpoints yet.</div>`;
  }

  async function createCheckpoint() {
    const state = workspaceState.getState();
    if (!state.active_document_id || state.save_status === "error") return;
    await workspaceApi.createCheckpoint(state.active_document_id);
    eventBus.emit("checkpoint.created", { documentId: state.active_document_id });
    await refresh();
  }

  async function restore(checkpointId) {
    const state = workspaceState.getState();
    if (!state.active_document_id) return;
    const document = await workspaceApi.restoreCheckpoint(state.active_document_id, checkpointId);
    workspaceState.markSavedFromServer(document);
    eventBus.emit("checkpoint.restored", { documentId: state.active_document_id, checkpointId });
  }

  const onClick = (event) => {
    const button = event.target.closest("[data-checkpoint-id]");
    if (!button) return;
    void restore(button.dataset.checkpointId);
  };
  refs.checkpointsList.addEventListener("click", onClick);

  return {
    createCheckpoint,
    refresh,
    dispose() {
      refs.checkpointsList.removeEventListener("click", onClick);
    },
  };
}
