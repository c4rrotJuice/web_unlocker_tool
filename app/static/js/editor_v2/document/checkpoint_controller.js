import { withTimeout } from "../core/async_operation.js";

export function createCheckpointController({ workspaceState, workspaceApi, refs, eventBus }) {
  let refreshSeq = 0;
  let target = refs.checkpointsList || null;
  let lastCheckpoints = [];
  let lastError = null;

  function updateCheckpointStatus(checkpoints = []) {
    if (!refs.checkpointStatus) return;
    if (!workspaceState.getState().active_document_id) {
      refs.checkpointStatus.textContent = "No document";
      return;
    }
    if (!checkpoints.length) {
      refs.checkpointStatus.textContent = "No checkpoints";
      return;
    }
    const latest = checkpoints[0];
    refs.checkpointStatus.textContent = `${checkpoints.length} saved · ${latest.created_at || "recent"}`;
  }

  function renderTarget() {
    if (!target) return;
    const documentId = workspaceState.getState().active_document_id;
    if (!documentId) {
      target.innerHTML = `<div class="editor-v2-card">No active document.</div>`;
      return;
    }
    if (lastError) {
      target.innerHTML = `
        <div class="editor-v2-card">
          <h3>Checkpoint refresh failed</h3>
          <p>${lastError.message || "Checkpoint history could not be refreshed."}</p>
          <button class="editor-v2-action" type="button" data-checkpoint-retry="true">Retry checkpoints</button>
        </div>
      `;
      return;
    }
    target.innerHTML = lastCheckpoints.length
      ? lastCheckpoints.map((item) => `
        <button class="editor-v2-checkpoint-item" type="button" data-checkpoint-id="${item.id}">
          <strong>${item.label || "Checkpoint"}</strong>
          <div class="editor-v2-meta">${item.created_at || ""}</div>
        </button>
      `).join("")
      : `<div class="editor-v2-card">No checkpoints yet.</div>`;
  }

  async function refresh() {
    const documentId = workspaceState.getState().active_document_id;
    if (!documentId) {
      lastCheckpoints = [];
      lastError = null;
      renderTarget();
      updateCheckpointStatus([]);
      return;
    }
    refreshSeq += 1;
    const sequence = refreshSeq;
    workspaceState.setCheckpointActivity({ phase: "running", sequence, document_id: documentId, message: null });
    eventBus.emit("checkpoints.refresh.started", { sequence, documentId });
    try {
      const checkpoints = await withTimeout(workspaceApi.listCheckpoints(documentId), { label: "Checkpoint refresh" });
      lastCheckpoints = checkpoints;
      lastError = null;
      workspaceState.setCheckpointFailure(null);
      workspaceState.setCheckpointActivity({ phase: "idle", sequence, document_id: documentId, message: null });
      eventBus.emit("checkpoints.refresh.succeeded", { sequence, documentId });
      renderTarget();
      updateCheckpointStatus(checkpoints);
    } catch (error) {
      lastError = {
        message: error?.message || "Checkpoint history could not be refreshed.",
      };
      lastCheckpoints = [];
      workspaceState.setCheckpointFailure({
        message: error?.message || "Checkpoint history could not be refreshed.",
      });
      workspaceState.setCheckpointActivity({
        phase: "error",
        sequence,
        document_id: documentId,
        message: error?.message || "Checkpoint history could not be refreshed.",
      });
      eventBus.emit("checkpoints.refresh.failed", { sequence, documentId, error });
      renderTarget();
      if (refs.checkpointStatus) refs.checkpointStatus.textContent = "Checkpoint error";
    }
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
    const document = await workspaceApi.restoreCheckpoint(
      state.active_document_id,
      checkpointId,
      state.active_document.revision || state.active_document.updated_at,
    );
    workspaceState.markSavedFromServer(document);
    eventBus.emit("checkpoint.restored", { documentId: state.active_document_id, checkpointId });
    await refresh();
  }

  const onClick = (event) => {
    const retryButton = event.target.closest("[data-checkpoint-retry]");
    if (retryButton) {
      void refresh();
      return;
    }
    const button = event.target.closest("[data-checkpoint-id]");
    if (!button) return;
    void restore(button.dataset.checkpointId);
  };

  return {
    createCheckpoint,
    refresh,
    setTarget(nextTarget) {
      target = nextTarget || null;
      renderTarget();
    },
    clearTarget() {
      if (target) target.innerHTML = "";
      target = null;
    },
    handleClick: onClick,
    dispose() {
    },
  };
}
