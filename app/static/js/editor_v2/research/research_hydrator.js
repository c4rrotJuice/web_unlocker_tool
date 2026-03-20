export function createResearchHydrator({
  workspaceState,
  eventBus,
  stores,
  renderExplorer,
}) {
  let explorerAbort = null;
  let detailAbort = null;

  function consumeDocumentHydration(payload = {}) {
    const attached = {
      citations: Array.isArray(payload.attached_citations) ? payload.attached_citations : [],
      notes: Array.isArray(payload.attached_notes) ? payload.attached_notes : [],
      quotes: Array.isArray(payload.attached_quotes) ? payload.attached_quotes : [],
      sources: Array.isArray(payload.attached_sources) ? payload.attached_sources : [],
    };
    stores.citations?.prime?.(attached.citations);
    stores.notes?.prime?.(attached.notes);
    stores.quotes?.prime?.(attached.quotes);
    stores.sources?.prime?.(attached.sources);
    workspaceState.setAttachedResearch(attached);
    return attached;
  }

  async function hydrateExplorer(type, params = {}) {
    if (explorerAbort) explorerAbort.abort();
    explorerAbort = new AbortController();
    const projectId = workspaceState.getState().active_project_id;
    const documentId = workspaceState.getState().active_document_id;
    const query = params.query || "";
    let rows = [];
    try {
      if (type === "sources") {
        rows = await stores.sources.list({ query, limit: 24 });
      } else if (type === "citations") {
        rows = await stores.citations.list({ search: query, limit: 24 });
      } else if (type === "quotes") {
        rows = await stores.quotes.list({ query, documentId: documentId || "", limit: 24 });
      } else if (type === "notes") {
        rows = await stores.notes.list({ query, projectId: projectId || "", limit: 24 });
      }
    } catch (error) {
      if (explorerAbort.signal.aborted) return [];
      workspaceState.setExplorerHydrated(type, false);
      workspaceState.setExplorerFailure(type, {
        type,
        message: error?.message || `Failed to load ${type}.`,
      });
      throw error;
    }
    if (explorerAbort.signal.aborted) return [];
    workspaceState.setExplorerHydrated(type, true);
    workspaceState.setExplorerFailure(type, null);
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
    consumeDocumentHydration,
    hydrateExplorer,
    hydrateFocused,
    dispose,
  };
}
