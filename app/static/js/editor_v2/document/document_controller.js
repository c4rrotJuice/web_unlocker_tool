export function createDocumentController({
  workspaceState,
  workspaceApi,
  refs,
  quillAdapter,
  autosaveController,
  eventBus,
}) {
  let openToken = 0;

  async function openDocument(documentId, { seed = null } = {}) {
    if (!documentId) {
      workspaceState.resetForEmptyEntry(seed);
      refs.emptyState.hidden = false;
      refs.writingSurface.hidden = true;
      refs.titleInput.value = "";
      quillAdapter.setContents({ ops: [{ insert: "\n" }] });
      return;
    }
    openToken += 1;
    const token = openToken;
    refs.emptyState.hidden = true;
    refs.writingSurface.hidden = false;
    workspaceState.setSeedState(seed);
    const document = await workspaceApi.getDocument(documentId);
    if (token !== openToken) return;
    workspaceState.setDocument(document);
    refs.titleInput.value = document.title || "";
    quillAdapter.setContents(document.content_delta || { ops: [{ insert: "\n" }] });
    eventBus.emit("hydration:completed", { area: "document" });
    void workspaceApi.hydrateDocument(documentId, seed).then((payload) => {
      if (token !== openToken) return;
      const hydratedDocument = payload.document || document;
      workspaceState.setDocument(hydratedDocument);
      workspaceState.setSeedState(payload.seed || seed);
      workspaceState.setHydrationFlag("attached_ready", true);
      eventBus.emit("hydration:completed", { area: "attached" });
    });
  }

  async function createDocument() {
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
    dispose() {
      refs.titleInput.removeEventListener("input", onTitleInput);
    },
  };
}
