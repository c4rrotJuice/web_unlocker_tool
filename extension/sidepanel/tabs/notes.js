function noteCard(note) {
  return `
    <article class="workspace-item">
      <header>
        <strong>${note.title}</strong>
        <span>${note.sync_status}</span>
      </header>
      <p>${note.preview || "No preview yet."}</p>
    </article>
  `;
}

export function renderNotesTab(root, state) {
  const notes = state.summary?.notes || [];
  root.innerHTML = `
    <section class="workspace-card">
      <h2>Notes</h2>
      <div class="workspace-stack">
        ${notes.length ? notes.map(noteCard).join("") : '<p class="workspace-empty">No notes captured yet.</p>'}
      </div>
    </section>
  `;
}

