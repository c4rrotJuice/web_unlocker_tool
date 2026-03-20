function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function noteCard(note) {
  return `
    <article class="workspace-item" data-note-id="${note.id}">
      <header>
        <strong>${escapeHtml(note.title || "Untitled note")}</strong>
        <span>${escapeHtml(note.sync_status || "local")}</span>
      </header>
      <input type="text" data-note-field="title" value="${escapeHtml(note.title || "")}" />
      <textarea data-note-field="note_body" rows="4">${escapeHtml(note.note_body || "")}</textarea>
      <p>${escapeHtml(note.preview || "No preview yet.")}</p>
      <footer class="workspace-actions-inline">
        <button type="button" data-action="update-note" data-note-id="${note.id}">Save</button>
        <button type="button" data-action="delete-note" data-note-id="${note.id}">Delete</button>
      </footer>
    </article>
  `;
}

export function renderNotesTab(root, state) {
  const notes = state.summary?.notes || [];
  root.innerHTML = `
    <section class="workspace-card">
      <h2>Notes</h2>
      <p>Edit locally and sync through background replay.</p>
      <div class="workspace-stack">
        ${notes.length ? notes.map(noteCard).join("") : '<p class="workspace-empty">No notes captured yet.</p>'}
      </div>
    </section>
  `;
}
