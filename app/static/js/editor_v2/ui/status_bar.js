export function renderStatusBar(target, quillAdapter, workspaceState, statusSnapshot = null) {
  const state = workspaceState.getState();
  const text = quillAdapter.getText().trim();
  const words = text ? text.split(/\s+/).length : 0;
  const chars = text.length;
  const citations = state.attached_relation_ids.citations.length;
  const notes = state.attached_relation_ids.notes.length;
  const statusLabel = statusSnapshot?.label || "Saved";
  target.innerHTML = `
    <span class="editor-v2-status-signal" aria-live="polite">${statusLabel}</span>
    <span>Words: ${words}</span>
    <span>Characters: ${chars}</span>
    <span>Citations: ${citations}</span>
    <span>Notes: ${notes}</span>
  `;
}
