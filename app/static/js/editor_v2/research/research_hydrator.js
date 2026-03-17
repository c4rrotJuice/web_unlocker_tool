export function createResearchHydrator({
  workspaceState,
  eventBus,
  stores,
  renderExplorer,
}) {
  let explorerAbort = null;
  let detailAbort = null;

  async function hydrateExplorer(type, params = {}) {
    if (explorerAbort) explorerAbort.abort();
    explorerAbort = new AbortController();
    const projectId = workspaceState.getState().active_project_id;
    const query = params.query || "";
    let rows = [];
    if (type === "sources") {
      rows = await stores.sources.list({ query, limit: 24 });
    } else if (type === "citations") {
      rows = await stores.citations.list({ search: query, limit: 24 });
    } else if (type === "quotes") {
      rows = await stores.quotes.list({ query, documentId: "", limit: 24 });
    } else if (type === "notes") {
      rows = await stores.notes.list({ query, projectId: projectId || "", limit: 24 });
    }
    if (explorerAbort.signal.aborted) return [];
    workspaceState.setExplorerHydrated(type, true);
    eventBus.emit("hydration:completed", { area: `explorer:${type}` });
    renderExplorer(type, rows, { projectId });
    return rows;
  }

  async function hydrateFocused(entity) {
    if (!entity?.id || !entity?.type) return null;
    if (detailAbort) detailAbort.abort();
    detailAbort = new AbortController();
    let detail = null;
    if (entity.type === "source") detail = await stores.sources.get(entity.id);
    if (entity.type === "citation") detail = await stores.citations.get(entity.id);
    if (entity.type === "quote") detail = await stores.quotes.get(entity.id);
    if (entity.type === "note") detail = await stores.notes.get(entity.id);
    if (detailAbort.signal.aborted) return null;
    workspaceState.setDetailHydrated(`${entity.type}:${entity.id}`, true);
    eventBus.emit("hydration:completed", { area: `detail:${entity.type}`, id: entity.id });
    return detail;
  }

  function dispose() {
    if (explorerAbort) explorerAbort.abort();
    if (detailAbort) detailAbort.abort();
  }

  return {
    hydrateExplorer,
    hydrateFocused,
    dispose,
  };
}
