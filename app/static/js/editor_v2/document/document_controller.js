import { withTimeout } from "../core/async_operation.js";
import { isAuthSessionError } from "../../shared/auth/session.js";

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
  let transitionSeq = 0;
  let hydrateSeq = 0;
  let transitionInFlight = null;
  let hydrateInFlight = null;

  function startTransition(kind, documentId) {
    transitionSeq += 1;
    const sequence = transitionSeq;
    workspaceState.setDocumentTransitionActivity({
      phase: "running",
      sequence,
      kind,
      document_id: documentId || null,
      message: null,
    });
    eventBus.emit("document.transition.started", { sequence, kind, documentId: documentId || null });
    return sequence;
  }

  function finishTransition(sequence, kind, documentId) {
    if (workspaceState.getState().runtime_activity.document_transition.sequence !== sequence) return;
    workspaceState.setDocumentTransitionActivity({
      phase: "idle",
      sequence,
      kind,
      document_id: documentId || null,
      message: null,
    });
    eventBus.emit("document.transition.succeeded", { sequence, kind, documentId: documentId || null });
  }

  function failTransition(sequence, kind, documentId, error) {
    if (workspaceState.getState().runtime_activity.document_transition.sequence !== sequence) return;
    workspaceState.setDocumentTransitionActivity({
      phase: "error",
      sequence,
      kind,
      document_id: documentId || null,
      message: error?.message || "Document transition failed",
    });
    eventBus.emit("document.transition.failed", { sequence, kind, documentId: documentId || null, error });
  }

  async function ensureTransitionReady() {
    const state = workspaceState.getState();
    if (!state.active_document_id || !state.dirty) {
      workspaceState.setDocumentTransitionFailure(null);
      return true;
    }
    try {
      await autosaveController.flush();
    } catch (error) {
      if (isAuthSessionError(error)) {
        workspaceState.setSessionFailure({
          code: error?.code || "missing_credentials",
          label: "Session expired",
          message: error?.message || "Session expired. Sign in again to continue editing.",
        });
        workspaceState.setDocumentTransitionFailure(null);
        return false;
      }
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
    if (hydrateInFlight && pendingHydration?.documentId === documentId && token === openToken) {
      return hydrateInFlight;
    }
    hydrateSeq += 1;
    const sequence = hydrateSeq;
    pendingHydration = { documentId, seed };
    workspaceState.setHydrateActivity({
      phase: "running",
      sequence,
      document_id: documentId,
      message: null,
    });
    eventBus.emit("document.hydrate.started", { sequence, documentId });
    const currentHydrate = (async () => {
      try {
      const payload = await withTimeout(workspaceApi.hydrateDocument(documentId, seed), { label: "Hydrate" });
      if (token !== openToken) {
        if (workspaceState.getState().runtime_activity.hydrate.sequence === sequence) {
          workspaceState.setHydrateActivity({ phase: "idle", sequence, document_id: documentId, message: null });
        }
        return false;
      }
      workspaceState.setSeedState(payload.seed || seed);
      hydrator.consumeDocumentHydration(payload);
      workspaceState.setHydrationFlag("attached_ready", true);
      workspaceState.setDocumentHydrateFailure(null);
      workspaceState.setHydrateActivity({ phase: "idle", sequence, document_id: documentId, message: null });
      eventBus.emit("hydration:completed", { area: "attached" });
      eventBus.emit("document.hydrate.succeeded", { sequence, documentId });
      return true;
    } catch (error) {
      if (token !== openToken) {
        if (workspaceState.getState().runtime_activity.hydrate.sequence === sequence) {
          workspaceState.setHydrateActivity({ phase: "idle", sequence, document_id: documentId, message: null });
        }
        return false;
      }
      workspaceState.setHydrationFlag("attached_ready", false);
      workspaceState.setDocumentHydrateFailure({
        documentId,
        message: error?.message || "Document research context could not be loaded.",
      });
      if (isAuthSessionError(error)) {
        workspaceState.setSessionFailure({
          code: error?.code || "missing_credentials",
          label: "Session expired",
          message: error?.message || "Session expired. Sign in again to continue editing.",
        });
      }
      workspaceState.setHydrateActivity({
        phase: "error",
        sequence,
        document_id: documentId,
        message: error?.message || "Document research context could not be loaded.",
      });
      eventBus.emit("document.hydrate.failed", { sequence, documentId, error });
      return false;
      } finally {
        if (hydrateInFlight === currentHydrate) {
          hydrateInFlight = null;
        }
      }
    })();
    hydrateInFlight = currentHydrate;
    return currentHydrate;
  }

  async function openDocument(documentId, { seed = null } = {}) {
    if (transitionInFlight) {
      openToken += 1;
    }
    const transitionSequence = startTransition(documentId ? "open" : "empty", documentId);
    transitionInFlight = (async () => {
      if (!await ensureTransitionReady()) {
      failTransition(transitionSequence, documentId ? "open" : "empty", documentId, new Error("Unsaved changes blocked document transition"));
      return false;
      }
      if (!documentId) {
      workspaceState.resetForEmptyEntry(seed);
      refs.emptyState.hidden = false;
      refs.writingSurface.hidden = true;
      refs.titleInput.value = "";
      quillAdapter.setContents({ ops: [{ insert: "\n" }] });
      finishTransition(transitionSequence, "empty", null);
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
        document = await withTimeout(workspaceApi.getDocument(documentId), { label: "Open document" });
      } catch (error) {
        if (isAuthSessionError(error)) {
          workspaceState.setSessionFailure({
            code: error?.code || "missing_credentials",
            label: "Session expired",
            message: error?.message || "Session expired. Sign in again to continue editing.",
          });
        }
        workspaceState.setDocumentHydrateFailure({
          documentId,
          message: error?.message || "Document could not be opened.",
        });
        failTransition(transitionSequence, "open", documentId, error);
        return false;
      }
      if (token !== openToken) {
        finishTransition(transitionSequence, "open", documentId);
        return false;
      }
      workspaceState.setDocument(document);
      refs.titleInput.value = document.title || "";
      quillAdapter.setContents(document.content_delta || { ops: [{ insert: "\n" }] });
      eventBus.emit("hydration:completed", { area: "document" });
      finishTransition(transitionSequence, "open", documentId);
      void hydrateAttached(documentId, seed, document, token);
      return true;
    })();
    try {
      return await transitionInFlight;
    } finally {
      transitionInFlight = null;
    }
  }

  async function createDocument() {
    const transitionSequence = startTransition("create", null);
    if (!await ensureTransitionReady()) {
      failTransition(transitionSequence, "create", null, new Error("Unsaved changes blocked document transition"));
      return null;
    }
    let document = null;
    try {
      document = await withTimeout(workspaceApi.createDocument({}), { label: "Create document" });
    } catch (error) {
      failTransition(transitionSequence, "create", null, error);
      throw error;
    }
    const nextSeed = null;
    finishTransition(transitionSequence, "create", document.id);
    await openDocument(document.id, { seed: nextSeed });
    return document;
  }

  async function reloadCurrentDocument() {
    const state = workspaceState.getState();
    if (!state.active_document_id) return null;
    const documentId = state.active_document_id;
    const seed = state.seed_state || null;
    const token = ++openToken;
    let document = null;
    try {
      document = await withTimeout(workspaceApi.getDocument(documentId), { label: "Reload document" });
    } catch (error) {
      workspaceState.setDocumentHydrateFailure({
        documentId,
        message: error?.message || "Document could not be refreshed.",
      });
      return false;
    }
    if (token !== openToken) return false;
    workspaceState.setDocument(document);
    refs.titleInput.value = document.title || "";
    quillAdapter.setContents(document.content_delta || { ops: [{ insert: "\n" }] });
    void hydrateAttached(documentId, seed, document, token);
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
    reloadCurrentDocument,
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
