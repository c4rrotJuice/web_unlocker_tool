export function renderCaptureTab(root, state) {
  const sync = state.status?.sync || {};
  const drafts = state.summary?.drafts || [];
  const quotes = state.summary?.quotes || [];
  const queueItems = state.summary?.queue_items || [];
  root.innerHTML = `
    <section class="workspace-card">
      <h2>Capture</h2>
      <p>Sidepanel remains the persistent workspace. Captures sync in the background and survive auth loss until cleared.</p>
      <dl class="workspace-list">
        <div><dt>Pending queue</dt><dd>${sync.pending || 0}</dd></div>
        <div><dt>Failed items</dt><dd>${sync.failed || 0}</dd></div>
        <div><dt>Auth needed</dt><dd>${sync.auth_needed ? "Yes" : "No"}</dd></div>
      </dl>
      <div class="workspace-stack">
        ${drafts.length ? drafts.map((draft) => `
          <article class="workspace-item">
            <header>
              <strong>${draft.type}</strong>
              <span>local draft</span>
            </header>
            <p>${draft.title || "Untitled draft"}</p>
            <p>${draft.url || "No source URL"} </p>
            <p>${draft.summary || "No local summary yet."}</p>
            <footer class="workspace-actions-inline">
              <button type="button" data-action="resume-editor-draft" data-draft-id="${draft.id}">Resume in editor</button>
              <button type="button" data-action="remove-local-draft" data-draft-id="${draft.id}">Clear local draft</button>
            </footer>
          </article>
        `).join("") : '<p class="workspace-empty">No resumable local drafts.</p>'}
      </div>
      <div class="workspace-stack">
        <h3>Quote queue</h3>
        ${quotes.length ? quotes.map((quote) => `
          <article class="workspace-item">
            <header>
              <strong>${quote.sync_status || "local"}</strong>
              <span>${quote.citation_local_id || "no citation dependency"}</span>
            </header>
            <p>${quote.text || "No quote text captured."}</p>
            <p>${quote.last_error || "Awaiting replay or reconciliation."}</p>
          </article>
        `).join("") : '<p class="workspace-empty">No local quotes pending.</p>'}
      </div>
      <div class="workspace-stack">
        <h3>Queue debug</h3>
        ${queueItems.length ? queueItems.map((item) => `
          <article class="workspace-item">
            <header>
              <strong>${item.type}</strong>
              <span>${item.status}</span>
            </header>
            <p>${item.last_error || "No current error."}</p>
            <p>${item.next_attempt_at || "Replays when dependencies or auth recover."}</p>
          </article>
        `).join("") : '<p class="workspace-empty">No queued replay items.</p>'}
      </div>
    </section>
  `;
}
