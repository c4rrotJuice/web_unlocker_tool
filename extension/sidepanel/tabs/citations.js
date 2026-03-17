function citationCard(citation) {
  return `
    <article class="workspace-item">
      <header>
        <strong>${citation.title}</strong>
        <span>${citation.sync_status}</span>
      </header>
      <p>${citation.quote || "No excerpt available."}</p>
    </article>
  `;
}

export function renderCitationsTab(root, state) {
  const citations = state.summary?.citations || [];
  root.innerHTML = `
    <section class="workspace-card">
      <h2>Citations</h2>
      <div class="workspace-stack">
        ${citations.length ? citations.map(citationCard).join("") : '<p class="workspace-empty">No citations captured yet.</p>'}
      </div>
    </section>
  `;
}

