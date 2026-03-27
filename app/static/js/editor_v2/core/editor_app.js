import { readBootPayload } from "../../app_shell/core/boot.js";
import { createEventBus } from "./event_bus.js";
import { escapeHtml } from "../../app_shell/core/format.js";
import { createWorkspaceState } from "./workspace_state.js";
import { createSelectionState } from "./selection_state.js";
import { deriveContextState } from "./context_state.js";
import { createCommandRegistry } from "./command_registry.js";
import { bindKeyboardShortcuts } from "./keyboard.js";
import { createWorkspaceApi } from "../api/workspace_api.js";
import { createResearchApi } from "../api/research_api.js";
import { getEditorAccess } from "../api/capability_api.js";
import { composeEditorDelta, createQuillAdapter } from "../ui/quill_adapter.js";
import { getFocusedInlineEntity } from "../ui/inline_affordances.js";
import { renderDocumentList, renderExplorerList } from "../ui/explorer_renderer.js";
import { renderContextRail } from "../ui/context_rail_renderer.js";
import { renderStatusBar } from "../ui/status_bar.js";
import { hidePopover, renderCommandMenu } from "../ui/popovers.js";
import { bindExplorerPreview } from "../ui/explorer_preview.js";
import { bindToolbarController } from "../ui/toolbar_controller.js";
import { bindContextTabs } from "../ui/context_tabs_controller.js";
import { createSourceStore } from "../research/source_store.js";
import { createCitationStore } from "../research/citation_store.js";
import { createQuoteStore } from "../research/quote_store.js";
import { createNoteStore } from "../research/note_store.js";
import { createProjectStore } from "../research/project_store.js";
import { createTagStore } from "../research/tag_store.js";
import { createResearchHydrator } from "../research/research_hydrator.js";
import { createExplorerController } from "../research/explorer_controller.js";
import { createAttachActions } from "../actions/attach_actions.js";
import { createInsertActions } from "../actions/insert_actions.js";
import { createNoteActions } from "../actions/note_actions.js";
import { createLinkActions } from "../actions/link_actions.js";
import { createConvertActions } from "../actions/convert_actions.js";
import { createAutosaveController } from "../document/autosave_controller.js";
import { createCheckpointController } from "../document/checkpoint_controller.js";
import { createOutlineController } from "../document/outline_controller.js";
import { createExportController } from "../document/export_controller.js";
import { createDocumentController } from "../document/document_controller.js";
import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES } from "../../shared/feedback/feedback_tokens.js";
import { isAuthSessionError } from "../../shared/auth/session.js";

function queryRefs() {
  return {
    shell: document.getElementById("editor-v2-shell"),
    explorerSearch: document.getElementById("editor-explorer-search"),
    explorerList: document.getElementById("editor-explorer-list"),
    explorerHeading: document.getElementById("editor-explorer-heading"),
    explorerStatus: document.getElementById("editor-explorer-status"),
    explorerTabs: Array.from(document.querySelectorAll("[data-explorer-tab]")),
    explorerPreview: document.getElementById("editor-explorer-preview"),
    titleInput: document.getElementById("editor-document-title"),
    emptyState: document.getElementById("editor-empty-state"),
    writingSurface: document.getElementById("editor-writing-surface"),
    toolbar: "#editor-toolbar",
    quill: document.getElementById("editor-quill"),
    saveState: document.getElementById("editor-save-state"),
    statusBar: document.getElementById("editor-status-bar"),
    contextRail: document.getElementById("editor-context-rail"),
    contextMode: document.getElementById("editor-context-mode"),
    outlineList: document.getElementById("editor-outline-list"),
    checkpointsList: document.getElementById("editor-checkpoints-list"),
    commandMenu: document.getElementById("editor-command-menu"),
    commandButton: document.getElementById("editor-command-button"),
    checkpointButton: document.getElementById("editor-checkpoint-button"),
    exportButton: document.getElementById("editor-export-button"),
    toolbarToggle: document.getElementById("editor-toolbar-toggle"),
    contextTabButtons: Array.from(document.querySelectorAll("[data-context-tab]")),
    contextPanes: Array.from(document.querySelectorAll("[data-context-pane]")),
    notesPanel: document.getElementById("editor-notes-panel"),
    newDocumentButton: document.getElementById("editor-new-document"),
    emptyNewDocumentButton: document.getElementById("editor-empty-new-document"),
    emptyFocusExplorerButton: document.getElementById("editor-empty-focus-explorer"),
    outlineRefreshButton: document.getElementById("editor-outline-refresh"),
  };
}

function normalizeSeed(pageState) {
  const seed = pageState.seed || {};
  const hasSeedIds = !!(seed.source_id || seed.citation_id || seed.quote_id || seed.note_id);
  if (!pageState.seeded && !hasSeedIds) return null;
  return {
    document_id: seed.document_id || pageState.document_id || null,
    source_id: seed.source_id || null,
    citation_id: seed.citation_id || null,
    quote_id: seed.quote_id || null,
    note_id: seed.note_id || null,
    mode: seed.mode || "seed_review",
  };
}

function saveStatusLabel(saveStatus) {
  return {
    saved: "Saved",
    saving: "Saving",
    offline: "Offline",
    conflict: "Conflict",
    error: "Error",
  }[saveStatus] || "Saved";
}

export async function createEditorApp({ boot = readBootPayload() } = {}) {
  const refs = queryRefs();
  const workspaceApi = createWorkspaceApi();
  const researchApi = createResearchApi();
  const eventBus = createEventBus();
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
  const workspaceState = createWorkspaceState();
  const selectionState = createSelectionState();

  const quillAdapter = createQuillAdapter({
    element: refs.quill,
    toolbarSelector: refs.toolbar,
    onTextChange: ({ delta, source }) => {
      if (source !== "user") return;
      const nextDelta = composeEditorDelta(workspaceState.getState().active_document?.content_delta, delta);
      workspaceState.markDirty({
        content_delta: nextDelta,
      });
      workspaceState.setSaveStatus("saving");
      autosaveController.schedule();
      outlineController.schedule(delta);
      renderStatusBar(refs.statusBar, quillAdapter, workspaceState, feedback.status.get(STATUS_SCOPES.EDITOR_DOCUMENT));
    },
    onSelectionChange: ({ range }) => {
      const text = range ? quillAdapter.getText(range) : "";
      selectionState.setSelection({
        range,
        text,
        collapsed: !range || range.length === 0,
      });
      const inlineEntity = getFocusedInlineEntity(quillAdapter.quill, range);
      if (inlineEntity) {
        workspaceState.setFocusedEntity(inlineEntity);
      }
    },
  });

  const autosaveController = createAutosaveController({
    workspaceState,
    workspaceApi,
    eventBus,
    snapshotProvider: () => ({
      content_html: quillAdapter.getHTML(),
    }),
  });
  const outlineController = createOutlineController({ refs, quillAdapter });
  const exportController = createExportController({ workspaceState, quillAdapter, eventBus });
  const checkpointController = createCheckpointController({ workspaceState, workspaceApi, refs, eventBus });
  const stores = {
    sources: createSourceStore(researchApi),
    citations: createCitationStore(researchApi),
    quotes: createQuoteStore(researchApi),
    notes: createNoteStore(researchApi),
    projects: createProjectStore(researchApi),
    tags: createTagStore(researchApi),
  };
  let currentExplorerRows = [];
  const hydrator = createResearchHydrator({
    workspaceState,
    eventBus,
    stores,
    renderExplorer(type, rows, { projectId }) {
      currentExplorerRows = rows;
      renderExplorerList(refs.explorerList, type, projectId
        ? rows.slice().sort((a, b) => Number((b.project_id || "") === projectId) - Number((a.project_id || "") === projectId))
        : rows, workspaceState.getState().focused_entity?.id || null);
    },
  });
  const attachActions = createAttachActions({ workspaceState, workspaceApi, eventBus });
  const insertActions = createInsertActions({ quillAdapter, attachActions, workspaceState, eventBus });
  const noteActions = createNoteActions({
    researchApi,
    attachActions,
    workspaceState,
    eventBus,
    stores,
  });
  createLinkActions();
  createConvertActions();
  const documentController = createDocumentController({
    workspaceState,
    workspaceApi,
    refs,
    quillAdapter,
    autosaveController,
    hydrator,
    eventBus,
  });
  const explorerController = createExplorerController({
    workspaceState,
    refs,
    renderers: { renderDocumentList },
    hydrator,
    onOpenDocument: (documentId) => void documentController.openDocument(documentId, { seed: null }).then(() => {
      void checkpointController.refresh();
      outlineController.compute();
    }),
    onFocusEntity: (entity) => {
      workspaceState.setPendingExplorerAction(null);
      workspaceState.setFocusedEntity(entity);
      eventBus.emit("focus:changed", entity);
    },
    onEntityAction: async (pending, entity) => {
      const store = stores[`${pending.entityType}s`];
      const detail = await store?.get?.(entity.id);
      if (!detail) return;
      if (pending.action === "insert") {
        if (pending.entityType === "citation") await insertActions.insertCitation(detail);
        if (pending.entityType === "quote") await insertActions.insertQuote(detail);
        if (pending.entityType === "note") await insertActions.insertNote(detail);
      }
      workspaceState.setPendingExplorerAction(null);
    },
  });

  const commandRegistry = createCommandRegistry({
    workspaceState,
    selectionState,
    handlers: {
      openInsertSearch(kind) {
        hidePopover(refs.commandMenu);
        void explorerController.beginEntityAction({
          action: "insert",
          entityType: kind.slice(0, -1),
        });
      },
      focusExplorerSearch() {
        explorerController.focusSearch();
      },
      createCheckpoint() {
        return checkpointController.createCheckpoint();
      },
      async insertBibliography() {
        const citationIds = workspaceState.getState().attached_relation_ids.citations;
        const citations = await Promise.all(citationIds.map((citationId) => stores.citations.get(citationId)));
        insertActions.insertBibliography(citations.filter(Boolean));
      },
    },
    renderMenu(commands, filter) {
      renderCommandMenu(refs.commandMenu, commands, filter);
    },
  });

  const toolbarController = bindToolbarController({
    toolbar: document.getElementById("editor-toolbar"),
    onInsertCitation() {
      commandRegistry.open("citation");
    },
  });
  const contextTabsController = bindContextTabs({
    buttons: refs.contextTabButtons,
    panes: refs.contextPanes,
  });
  const disposeExplorerPreview = bindExplorerPreview({
    list: refs.explorerList,
    panel: refs.explorerPreview,
  });

  const cleanupKeyboard = bindKeyboardShortcuts({
    root: quillAdapter.root,
    selectionState,
    commandRegistry,
    handlers: {
      openCommandMenu(filter) {
        commandRegistry.open(filter);
      },
      focusExplorerSearch() {
        explorerController.focusSearch();
      },
    },
  });

  function renderShell() {
    const state = workspaceState.getState();
    const sessionFailure = state.runtime_failures?.session;
    const statusSnapshot = sessionFailure
      ? { label: sessionFailure.label || sessionFailure.message || "Session expired" }
      : { label: saveStatusLabel(state.save_status) };
    refs.saveState.textContent = statusSnapshot.label;
    renderStatusBar(refs.statusBar, quillAdapter, workspaceState, statusSnapshot);
    const context = deriveContextState(state, selectionState.getState());
    refs.contextMode.textContent = context.mode.replace(/_/g, " ");
    const focused = state.focused_entity;
    const attachedNotes = state.attached_research?.notes || [];
    refs.notesPanel.innerHTML = attachedNotes.length
      ? `<div class="editor-v2-list">${attachedNotes.map((note) => `<div class="editor-v2-card"><strong>${escapeHtml(note.title || "Note")}</strong><p>${escapeHtml((note.text || "").slice(0, 160))}</p></div>`).join("")}</div>`
      : `<div class="editor-v2-card">No attached notes yet.</div>`;
    if (!focused && context.mode !== "seed_review" && context.mode !== "quote_focus") {
      renderContextRail(refs.contextRail, context, state, null, {
        selectionText: () => selectionState.getState().text,
      });
      return;
    }
    const detailKey = focused ? `${focused.type}:${focused.id}` : (state.seed_state?.quote_id ? `quote:${state.seed_state.quote_id}` : null);
    const promise = focused
      ? (state.hydration.detail_by_key[detailKey]
        ? stores[`${focused.type}s`]?.get?.(focused.id)
        : hydrator.hydrateFocused(focused))
      : (state.seed_state?.quote_id ? stores.quotes.get(state.seed_state.quote_id) : Promise.resolve(null));
    void promise.then((detail) => {
      renderContextRail(refs.contextRail, context, state, detail, {
        selectionText: () => selectionState.getState().text,
      });
    }).catch(() => {
      renderContextRail(refs.contextRail, context, workspaceState.getState(), null, {
        selectionText: () => selectionState.getState().text,
      });
    });
  }

  const unsubWorkspace = workspaceState.subscribe(renderShell);
  const unsubSelection = selectionState.subscribe(renderShell);
  const unsubFeedback = feedback.status.subscribe((_statuses, { scope }) => {
    if (scope && scope !== STATUS_SCOPES.EDITOR_DOCUMENT) return;
    const state = workspaceState.getState();
    const sessionFailure = state.runtime_failures?.session;
    const statusSnapshot = sessionFailure
      ? { label: sessionFailure.label || sessionFailure.message || "Session expired" }
      : { label: saveStatusLabel(state.save_status) };
    refs.saveState.textContent = statusSnapshot.label;
    renderStatusBar(refs.statusBar, quillAdapter, workspaceState, statusSnapshot);
  });

  eventBus.on("doc.save.started", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_STARTED, payload));
  eventBus.on("doc.save.succeeded", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_SUCCEEDED, payload));
  eventBus.on("doc.save.conflict", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_CONFLICT, payload));
  eventBus.on("doc.save.failed", ({ offline, error }) => {
    const authLost = isAuthSessionError(error);
    if (authLost) {
      workspaceState.setSessionFailure({
        code: error?.code || "missing_credentials",
        label: "Session expired",
        message: error?.message || "Session expired. Sign in again to resume saving.",
      });
      feedback.emitDomainEvent(FEEDBACK_EVENTS.SESSION_EXPIRED, {
        scope: STATUS_SCOPES.EDITOR_DOCUMENT,
        message: error?.message || "Session expired. Sign in again to resume saving.",
        onAction() {
          window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        },
      });
      return;
    }
    feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_FAILED, {
      offline,
      message: error?.message || "Your latest edits could not be saved.",
    });
  });
  eventBus.on("checkpoint.created", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.CHECKPOINT_CREATED, payload));
  eventBus.on("checkpoint.restored", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.CHECKPOINT_RESTORED, payload));
  eventBus.on("document.export.succeeded", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOCUMENT_EXPORT_SUCCEEDED, payload));
  eventBus.on("document.export.failed", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOCUMENT_EXPORT_FAILED, payload));
  eventBus.on("citation.attached", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.CITATION_ATTACHED, payload));
  eventBus.on("citation.attach_skipped", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.CITATION_ATTACH_SKIPPED, payload));
  eventBus.on("note.attached", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.NOTE_ATTACHED, payload));
  eventBus.on("quote.inserted", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.QUOTE_INSERTED, payload));
  eventBus.on("bibliography.inserted", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.BIBLIOGRAPHY_INSERTED, payload));

  function wireUi() {
    const cleanups = [];
    const commandClick = () => commandRegistry.open("");
    const checkpointClick = () => void checkpointController.createCheckpoint();
    const exportClick = () => exportController.exportHtml();
    const newDocumentClick = () => void documentController.createDocument()
      .then(() => outlineController.compute())
      .catch(() => {});
    const focusExplorerClick = () => explorerController.focusSearch();
    const outlineRefreshClick = () => outlineController.compute();
    const commandMenuClick = (event) => {
      const command = event.target.closest("[data-command-id]");
      if (!command) return;
      commandRegistry.invoke(command.dataset.commandId);
      hidePopover(refs.commandMenu);
    };
    const contextRailClick = async (event) => {
      const action = event.target.closest("[data-context-action]");
      if (!action) return;
      const state = workspaceState.getState();
      if (action.dataset.contextAction === "insert-seed-quote" && state.seed_state?.quote_id) {
        const quote = await stores.quotes.get(state.seed_state.quote_id);
        await insertActions.insertQuote(quote);
        workspaceState.setSeedState({ ...state.seed_state, mode: "idle" });
      }
      if (action.dataset.contextAction === "retry-hydrate") {
        await documentController.retryHydration();
      }
      if (action.dataset.contextAction === "reload-latest") {
        await documentController.reloadCurrentDocument();
        outlineController.compute();
      }
      if (action.dataset.contextAction === "retry-save") {
        try {
          await autosaveController.flush();
          workspaceState.setDocumentTransitionFailure(null);
        } catch (_error) {
          workspaceState.setDocumentTransitionFailure({
            message: "Latest edits are still unsaved. Retry save before switching documents.",
          });
        }
      }
      if (action.dataset.contextAction === "reconnect-session") {
        window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      }
      if (action.dataset.contextAction === "insert-quote" && selectionState.getState().text) {
        quillAdapter.insertText(quillAdapter.getSelection()?.index || 0, `> ${selectionState.getState().text}\n`);
      }
      if (action.dataset.contextAction === "create-note" && selectionState.getState().text) {
        await noteActions.createNoteFromSelection(selectionState.getState().text);
      }
      if (action.dataset.contextAction === "create-note-from-seed" && state.seed_state?.quote_id) {
        const quote = await stores.quotes.get(state.seed_state.quote_id);
        await noteActions.createNoteFromQuote(quote, state.seed_state);
      }
      if (action.dataset.contextAction === "start-outline") {
        quillAdapter.focus();
        quillAdapter.insertText(quillAdapter.getSelection()?.index || 0, "\n## Outline\n");
      }
    };
    refs.commandButton.addEventListener("click", commandClick);
    refs.checkpointButton.addEventListener("click", checkpointClick);
    refs.exportButton.addEventListener("click", exportClick);
    refs.newDocumentButton.addEventListener("click", newDocumentClick);
    refs.emptyNewDocumentButton.addEventListener("click", newDocumentClick);
    refs.emptyFocusExplorerButton.addEventListener("click", focusExplorerClick);
    refs.outlineRefreshButton.addEventListener("click", outlineRefreshClick);
    refs.commandMenu.addEventListener("click", commandMenuClick);
    refs.contextRail.addEventListener("click", contextRailClick);
    cleanups.push(() => refs.commandButton.removeEventListener("click", commandClick));
    cleanups.push(() => refs.checkpointButton.removeEventListener("click", checkpointClick));
    cleanups.push(() => refs.exportButton.removeEventListener("click", exportClick));
    cleanups.push(() => refs.newDocumentButton.removeEventListener("click", newDocumentClick));
    cleanups.push(() => refs.emptyNewDocumentButton.removeEventListener("click", newDocumentClick));
    cleanups.push(() => refs.emptyFocusExplorerButton.removeEventListener("click", focusExplorerClick));
    cleanups.push(() => refs.outlineRefreshButton.removeEventListener("click", outlineRefreshClick));
    cleanups.push(() => refs.commandMenu.removeEventListener("click", commandMenuClick));
    cleanups.push(() => refs.contextRail.removeEventListener("click", contextRailClick));
    return () => {
      while (cleanups.length) {
        cleanups.pop()();
      }
    };
  }

  return {
    async start() {
      await getEditorAccess();
      quillAdapter.setEnabled(false);
      const pageState = boot.page_state || {};
      workspaceState.setSeedState(normalizeSeed(pageState));
      const documentSummaries = await workspaceApi.listDocumentsSummary();
      workspaceState.setDocumentList(documentSummaries);
      explorerController.bind();
      void explorerController.prime();
      const documentId = pageState.document_id || "";
      let bootReady = true;
      if (documentId) {
        bootReady = await documentController.openDocument(documentId, { seed: normalizeSeed(pageState), awaitHydration: true });
      } else if (pageState.new_document) {
        await documentController.createDocument();
      } else {
        await documentController.openDocument(null, { seed: normalizeSeed(pageState), awaitHydration: true });
      }
      if (!bootReady) {
        return;
      }
      await checkpointController.refresh();
      outlineController.compute();
      quillAdapter.setEnabled(true);
      const uiCleanup = wireUi();
      this.dispose = () => {
        uiCleanup?.();
        cleanupKeyboard?.();
        toolbarController.dispose();
        contextTabsController.dispose();
        disposeExplorerPreview?.();
        unsubWorkspace?.();
        unsubSelection?.();
        unsubFeedback?.();
        explorerController.dispose();
        hydrator.dispose();
        autosaveController.dispose();
        checkpointController.dispose();
        outlineController.dispose();
        documentController.dispose();
        eventBus.clear();
      };
    },
    dispose() {},
  };
}
