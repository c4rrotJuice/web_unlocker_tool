function activityCard(activity) {
  return `
    <article class="workspace-item">
      <header>
        <strong>${activity.type || "activity"}</strong>
        <span>${activity.status || "pending"}</span>
      </header>
      <p>${activity.error || "Reconciled successfully."}</p>
    </article>
  `;
}

export function renderActivityTab(root, state) {
  const items = state.summary?.activity || [];
  root.innerHTML = `
    <section class="workspace-card">
      <h2>Activity</h2>
      <div class="workspace-stack">
        ${items.length ? items.map(activityCard).join("") : '<p class="workspace-empty">No sync activity yet.</p>'}
      </div>
    </section>
  `;
}

