import { readBootPayload } from "../../app_shell/core/boot.js";
import { createEventBus } from "./event_bus.js";
import { createWorkspaceState } from "./workspace_state.js";
import { createSelectionState } from "./selection_state.js";
import { deriveContextState } from "./context_state.js";
import { createCommandRegistry } from "./command_registry.js";
import { bindKeyboardShortcuts } from "./keyboard.js";
import { createWorkspaceApi } from "../api/workspace_api.js";
import { createResearchApi } from "../api/research_api.js";
import { getEditorAccess } from "../api/capability_api.js";
import { createQuillAdapter } from "../ui/quill_adapter.js";
import { getFocusedInlineEntity } from "../ui/inline_affordances.js";
import { renderDocumentList, renderExplorerList } from "../ui/explorer_renderer.js";
import { renderContextRail } from "../ui/context_rail_renderer.js";
import { renderStatusBar } from "../ui/status_bar.js";
import { hidePopover, renderCommandMenu } from "../ui/popovers.js";
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
import { createLinkActions } from "../actions/link_actions.js";
import { createConvertActions } from "../actions/convert_actions.js";
import { createAutosaveController } from "../document/autosave_controller.js";
import { createCheckpointController } from "../document/checkpoint_controller.js";
import { createOutlineController } from "../document/outline_controller.js";
import { createExportController } from "../document/export_controller.js";
import { createDocumentController } from "../document/document_controller.js";
import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES } from "../../shared/feedback/feedback_tokens.js";

function queryRefs() {
  return {
    shell: document.getElementById("editor-v2-shell"),
    documentList: document.getElementById("editor-document-list"),
    documentsStatus: document.getElementById("editor-documents-status"),
    explorerSearch: document.getElementById("editor-explorer-search"),
    explorerList: document.getElementById("editor-explorer-list"),
    explorerHeading: document.getElementById("editor-explorer-heading"),
    explorerStatus: document.getElementById("editor-explorer-status"),
    explorerTabs: Array.from(document.querySelectorAll("[data-explorer-tab]")),
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
    newDocumentButton: document.getElementById("editor-new-document"),
    emptyNewDocumentButton: document.getElementById("editor-empty-new-document"),
    emptyFocusExplorerButton: document.getElementById("editor-empty-focus-explorer"),
    outlineRefreshButton: document.getElementById("editor-outline-refresh"),
  };
}

function normalizeSeed(pageState) {
  const seed = pageState.seed || {};
  if (!pageState.seeded && !seed.citation_id) return null;
  return {
    document_id: seed.document_id || pageState.document_id || null,
    source_id: seed.source_id || null,
    citation_id: seed.citation_id || null,
    quote_id: seed.quote_id || null,
    note_id: seed.note_id || null,
    mode: seed.mode || "seed_review",
  };
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
      workspaceState.markDirty({
        content_delta: quillAdapter.getContents(),
        content_html: quillAdapter.getHTML(),
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

  const autosaveController = createAutosaveController({ workspaceState, workspaceApi, eventBus });
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
  createLinkActions();
  createConvertActions();
  const documentController = createDocumentController({
    workspaceState,
    workspaceApi,
    refs,
    quillAdapter,
    autosaveController,
    eventBus,
  });
  const explorerController = createExplorerController({
    workspaceState,
    refs,
    renderers: { renderDocumentList, renderExplorerList },
    hydrator,
    onOpenDocument: (documentId) => void documentController.openDocument(documentId, { seed: null }).then(() => {
      void checkpointController.refresh();
      outlineController.compute();
    }),
    onFocusEntity: (entity) => {
      workspaceState.setFocusedEntity(entity);
      eventBus.emit("focus:changed", entity);
    },
  });

  const commandRegistry = createCommandRegistry({
    workspaceState,
    selectionState,
    handlers: {
      openInsertSearch(kind) {
        refs.commandMenu.hidden = false;
        refs.commandMenu.innerHTML = `<div class="editor-v2-card">Use the explorer to choose a ${kind.slice(0, -1)}.</div>`;
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
    const statusSnapshot = feedback.status.get(STATUS_SCOPES.EDITOR_DOCUMENT);
    refs.saveState.textContent = statusSnapshot?.label || {
      saved: "Saved",
      saving: "Saving",
      offline: "Offline",
      error: "Error",
    }[state.save_status] || "Saved";
    renderDocumentList(refs.documentList, state.document_list || [], state.active_document_id);
    renderStatusBar(refs.statusBar, quillAdapter, workspaceState, statusSnapshot);
    const context = deriveContextState(state, selectionState.getState());
    refs.contextMode.textContent = context.mode.replace(/_/g, " ");
    const focused = state.focused_entity;
    if (!focused && context.mode !== "seed_review" && context.mode !== "quote_focus") {
      renderContextRail(refs.contextRail, context, state, null, {
        selectionText: () => selectionState.getState().text,
      });
      return;
    }
    const promise = focused
      ? hydrator.hydrateFocused(focused)
      : (state.seed_state?.quote_id ? stores.quotes.get(state.seed_state.quote_id) : Promise.resolve(null));
    void promise.then((detail) => {
      renderContextRail(refs.contextRail, context, state, detail, {
        selectionText: () => selectionState.getState().text,
      });
    });
  }

  const unsubWorkspace = workspaceState.subscribe(renderShell);
  const unsubSelection = selectionState.subscribe(renderShell);
  const unsubFeedback = feedback.status.subscribe((_statuses, { scope }) => {
    if (scope && scope !== STATUS_SCOPES.EDITOR_DOCUMENT) return;
    refs.saveState.textContent = feedback.status.get(STATUS_SCOPES.EDITOR_DOCUMENT)?.label || refs.saveState.textContent;
    renderStatusBar(refs.statusBar, quillAdapter, workspaceState, feedback.status.get(STATUS_SCOPES.EDITOR_DOCUMENT));
  });

  eventBus.on("doc.save.started", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_STARTED, payload));
  eventBus.on("doc.save.succeeded", (payload) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_SUCCEEDED, payload));
  eventBus.on("doc.save.failed", ({ offline, error }) => feedback.emitDomainEvent(FEEDBACK_EVENTS.DOC_SAVE_FAILED, {
    offline,
    message: error?.message || "Your latest edits could not be saved.",
  }));
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
    const newDocumentClick = () => void documentController.createDocument();
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
      if (action.dataset.contextAction === "insert-quote" && selectionState.getState().text) {
        quillAdapter.insertText(quillAdapter.getSelection()?.index || 0, `> ${selectionState.getState().text}\n`);
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
      const pageState = boot.page_state || {};
      workspaceState.setSeedState(normalizeSeed(pageState));
      const documentSummaries = await workspaceApi.listDocumentsSummary();
      workspaceState.setDocumentList(documentSummaries);
      refs.documentsStatus.textContent = "Ready";
      explorerController.bind();
      void explorerController.prime();
      const documentId = pageState.document_id || "";
      if (documentId) {
        await documentController.openDocument(documentId, { seed: normalizeSeed(pageState) });
      } else if (pageState.new_document) {
        await documentController.createDocument();
      } else {
        await documentController.openDocument(null, { seed: normalizeSeed(pageState) });
      }
      await checkpointController.refresh();
      outlineController.compute();
      const uiCleanup = wireUi();
      this.dispose = () => {
        uiCleanup?.();
        cleanupKeyboard?.();
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
