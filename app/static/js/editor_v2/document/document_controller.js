export function createDocumentController({
  workspaceState,
  workspaceApi,
  refs,
  quillAdapter,
  autosaveController,
  hydrator,
  eventBus,
}) {
  let openToken = 0;
  let pendingHydration = null;

  async function ensureTransitionReady() {
    const state = workspaceState.getState();
    if (!state.active_document_id || !state.dirty) {
      workspaceState.setDocumentTransitionFailure(null);
      return true;
    }
    try {
      await autosaveController.flush();
    } catch (error) {
      workspaceState.setDocumentTransitionFailure({
        message: error?.message || "Save failed. Retry save before switching documents.",
      });
      return false;
    }
    const refreshed = workspaceState.getState();
    if (refreshed.dirty || refreshed.save_status === "error" || refreshed.save_status === "offline") {
      workspaceState.setDocumentTransitionFailure({
        message: "Latest edits are still unsaved. Retry save before switching documents.",
      });
      return false;
    }
    workspaceState.setDocumentTransitionFailure(null);
    return true;
  }

  async function hydrateAttached(documentId, seed, document, token) {
    pendingHydration = { documentId, seed };
    try {
      const payload = await workspaceApi.hydrateDocument(documentId, seed);
      if (token !== openToken) return false;
      const hydratedDocument = payload.document || document;
      workspaceState.setDocument(hydratedDocument);
      workspaceState.setSeedState(payload.seed || seed);
      hydrator.consumeDocumentHydration(payload);
      workspaceState.setHydrationFlag("attached_ready", true);
      workspaceState.setDocumentHydrateFailure(null);
      eventBus.emit("hydration:completed", { area: "attached" });
      return true;
    } catch (error) {
      if (token !== openToken) return false;
      workspaceState.setHydrationFlag("attached_ready", false);
      workspaceState.setDocumentHydrateFailure({
        documentId,
        message: error?.message || "Document research context could not be loaded.",
      });
      return false;
    }
  }

  async function openDocument(documentId, { seed = null } = {}) {
    if (!await ensureTransitionReady()) return false;
    if (!documentId) {
      workspaceState.resetForEmptyEntry(seed);
      refs.emptyState.hidden = false;
      refs.writingSurface.hidden = true;
      refs.titleInput.value = "";
      quillAdapter.setContents({ ops: [{ insert: "\n" }] });
      return true;
    }
    openToken += 1;
    const token = openToken;
    refs.emptyState.hidden = true;
    refs.writingSurface.hidden = false;
    workspaceState.setSeedState(seed);
    workspaceState.setAttachedResearch({ citations: [], notes: [], quotes: [], sources: [] });
    workspaceState.setDocumentHydrateFailure(null);
    let document = null;
    try {
      document = await workspaceApi.getDocument(documentId);
    } catch (error) {
      workspaceState.setDocumentHydrateFailure({
        documentId,
        message: error?.message || "Document could not be opened.",
      });
      return false;
    }
    if (token !== openToken) return;
    workspaceState.setDocument(document);
    refs.titleInput.value = document.title || "";
    quillAdapter.setContents(document.content_delta || { ops: [{ insert: "\n" }] });
    eventBus.emit("hydration:completed", { area: "document" });
    return hydrateAttached(documentId, seed, document, token);
  }

  async function createDocument() {
    if (!await ensureTransitionReady()) return null;
    const document = await workspaceApi.createDocument({});
    const nextSeed = null;
    await openDocument(document.id, { seed: nextSeed });
    return document;
  }

  function onTitleInput() {
    workspaceState.markDirty({ title: refs.titleInput.value });
    workspaceState.setSaveStatus("saving");
    autosaveController.schedule();
  }

  refs.titleInput.addEventListener("input", onTitleInput);

  return {
    openDocument,
    createDocument,
    retryHydration() {
      if (!pendingHydration?.documentId) return false;
      const state = workspaceState.getState();
      return hydrateAttached(
        pendingHydration.documentId,
        pendingHydration.seed || state.seed_state || null,
        state.active_document,
        openToken,
      );
    },
    dispose() {
      refs.titleInput.removeEventListener("input", onTitleInput);
    },
  };
}
