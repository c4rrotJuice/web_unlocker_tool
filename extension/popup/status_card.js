export function renderStatusCard(root, status) {
  const session = status?.session || {};
  const sync = status?.sync || {};
  root.innerHTML = `
    <article class="workspace-card">
      <h2>Extension status</h2>
      <dl class="workspace-list">
        <div><dt>Session</dt><dd>${session.is_authenticated ? "Signed in" : "Signed out"}</dd></div>
        <div><dt>Queued</dt><dd>${sync.pending || 0}</dd></div>
        <div><dt>Failed</dt><dd>${sync.failed || 0}</dd></div>
        <div><dt>Auth needed</dt><dd>${sync.auth_needed ? "Yes" : "No"}</dd></div>
      </dl>
    </article>
  `;
}

