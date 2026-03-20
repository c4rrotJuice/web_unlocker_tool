import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceApi } from "../../app/static/js/editor_v2/api/workspace_api.js";
import { createWorkspaceState } from "../../app/static/js/editor_v2/core/workspace_state.js";
import { createResearchHydrator } from "../../app/static/js/editor_v2/research/research_hydrator.js";
import { createSourceStore } from "../../app/static/js/editor_v2/research/source_store.js";
import { createCitationStore } from "../../app/static/js/editor_v2/research/citation_store.js";
import { createQuoteStore } from "../../app/static/js/editor_v2/research/quote_store.js";
import { createNoteStore } from "../../app/static/js/editor_v2/research/note_store.js";
import { createDocumentController } from "../../app/static/js/editor_v2/document/document_controller.js";
import { renderContextRail } from "../../app/static/js/editor_v2/ui/context_rail_renderer.js";
import { createExplorerController } from "../../app/static/js/editor_v2/research/explorer_controller.js";
import { createCheckpointController } from "../../app/static/js/editor_v2/document/checkpoint_controller.js";
import { createNoteActions } from "../../app/static/js/editor_v2/actions/note_actions.js";

function okResponse(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, data, meta: {}, error: null };
    },
  };
}

function makeElement(extra = {}) {
  const listeners = new Map();
  return {
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
    dataset: {},
    focusCalled: false,
    selectCalled: false,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    dispatch(type, target) {
      const entries = listeners.get(type) || [];
      for (const listener of entries) {
        listener({ type, target });
      }
    },
    focus() {
      this.focusCalled = true;
    },
    select() {
      this.selectCalled = true;
    },
    classList: {
      toggle() {},
    },
    setAttribute() {},
    ...extra,
  };
}

function createDocumentRefs() {
  return {
    emptyState: makeElement(),
    writingSurface: makeElement(),
    titleInput: makeElement(),
  };
}

function createQuillStub() {
  return {
    contents: null,
    setContents(value) {
      this.contents = value;
    },
  };
}

test("workspace hydrate forwards non-citation seed ids to hydrate route", async () => {
  const requests = [];
  globalThis.window = {
    webUnlockerAuth: {
      async authFetch(path) {
        requests.push(path);
        return okResponse({ document: { id: "doc-1" } });
      },
    },
  };

  const api = createWorkspaceApi();
  await api.hydrateDocument("doc-1", {
    document_id: "doc-1",
    source_id: "source-1",
    quote_id: "quote-1",
    note_id: "note-1",
    mode: "seed_review",
  });

  assert.equal(
    requests[0],
    "/api/docs/doc-1/hydrate?seed_source_id=source-1&seed_quote_id=quote-1&seed_note_id=note-1&seed_mode=seed_review",
  );
});

test("attached hydrate payloads are consumed into runtime state and primed stores", async () => {
  const workspaceState = createWorkspaceState();
  const calls = { citationGet: 0 };
  const citation = { id: "citation-1", source: { id: "source-1", title: "Source 1" } };
  const note = { id: "note-1", title: "Note 1" };
  const quote = { id: "quote-1", excerpt: "Quote 1", citation_id: "citation-1" };
  const source = { id: "source-1", title: "Source 1" };
  const api = {
    async listSources() { return []; },
    async getSource() { throw new Error("should not fetch source"); },
    async listCitations() { return []; },
    async getCitation() { calls.citationGet += 1; return citation; },
    async listQuotes() { return []; },
    async getQuote() { throw new Error("should not fetch quote"); },
    async listNotes() { return []; },
    async getNote() { throw new Error("should not fetch note"); },
  };
  const stores = {
    sources: createSourceStore(api),
    citations: createCitationStore(api),
    quotes: createQuoteStore(api),
    notes: createNoteStore(api),
  };
  const hydrator = createResearchHydrator({
    workspaceState,
    eventBus: { emit() {} },
    stores,
    renderExplorer() {},
  });

  hydrator.consumeDocumentHydration({
    attached_citations: [citation],
    attached_notes: [note],
    attached_quotes: [quote],
    attached_sources: [source],
  });

  assert.equal(workspaceState.getState().attached_research.citations[0].id, "citation-1");
  const focused = await hydrator.hydrateFocused({ type: "citation", id: "citation-1" });
  assert.equal(focused.id, "citation-1");
  assert.equal(calls.citationGet, 0);
});

test("dirty document switches block when save flush fails", async () => {
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Unsaved title" });

  const refs = createDocumentRefs();
  const quillAdapter = createQuillStub();
  let getDocumentCalls = 0;
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        getDocumentCalls += 1;
        return { id: "doc-2", title: "Draft 2", content_delta: { ops: [{ insert: "Draft 2\n" }] } };
      },
      async hydrateDocument() {
        return { document: { id: "doc-2", title: "Draft 2", content_delta: { ops: [{ insert: "Draft 2\n" }] } } };
      },
      async createDocument() {
        return { id: "doc-3" };
      },
    },
    refs,
    quillAdapter,
    autosaveController: {
      async flush() {
        throw new Error("Save failed");
      },
      schedule() {},
    },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  const result = await controller.openDocument("doc-2");

  assert.equal(result, false);
  assert.equal(getDocumentCalls, 0);
  assert.match(workspaceState.getState().runtime_failures.document_transition.message, /save failed|unsaved/i);
});

test("document hydrate failure is user-visible and recoverable in context rail state", async () => {
  const workspaceState = createWorkspaceState();
  const refs = createDocumentRefs();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        return {
          id: "doc-1",
          title: "Draft",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft\n" }] },
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        throw new Error("Hydrate exploded");
      },
    },
    refs,
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  await controller.openDocument("doc-1", { seed: { quote_id: "quote-1", citation_id: "citation-1" } });
  const target = makeElement();
  renderContextRail(target, { mode: "idle" }, workspaceState.getState(), null, {});

  assert.match(target.innerHTML, /Document context failed to load/);
  assert.match(target.innerHTML, /Retry hydrate/);
});

test("explorer load failure renders a retryable recovery state", async () => {
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const refs = {
    explorerHeading: makeElement(),
    explorerStatus: makeElement(),
    explorerList: makeElement(),
    explorerSearch: makeElement(),
    explorerTabs: [],
  };
  const controller = createExplorerController({
    workspaceState,
    refs,
    renderers: { renderDocumentList() {} },
    hydrator: {
      async hydrateExplorer() {
        throw new Error("Explorer failed");
      },
    },
    onOpenDocument() {},
    onFocusEntity() {},
    onEntityAction() {},
  });

  await controller.beginEntityAction({ action: "insert", entityType: "quote" });

  assert.match(refs.explorerStatus.textContent, /failed/i);
  assert.match(refs.explorerList.innerHTML, /Retry/);
});

test("checkpoint refresh failure renders a retryable recovery state", async () => {
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const refs = { checkpointsList: makeElement() };
  const controller = createCheckpointController({
    workspaceState,
    workspaceApi: {
      async listCheckpoints() {
        throw new Error("Checkpoint refresh failed");
      },
    },
    refs,
    eventBus: { emit() {} },
  });

  await controller.refresh();

  assert.match(refs.checkpointsList.innerHTML, /Checkpoint refresh failed/);
  assert.match(refs.checkpointsList.innerHTML, /Retry checkpoints/);
});

test("explorer picker routes entity clicks into real insert flow callbacks", async () => {
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const citationsTab = makeElement({ dataset: { explorerTab: "citations" } });
  const quotesTab = makeElement({ dataset: { explorerTab: "quotes" } });
  const refs = {
    explorerHeading: makeElement(),
    explorerStatus: makeElement(),
    explorerList: makeElement(),
    explorerSearch: makeElement(),
    explorerTabs: [citationsTab, quotesTab],
  };
  const calls = [];
  const controller = createExplorerController({
    workspaceState,
    refs,
    renderers: { renderDocumentList() {} },
    hydrator: { async hydrateExplorer() { return []; } },
    onOpenDocument() {},
    onFocusEntity() {
      throw new Error("focus should not run while picker is armed");
    },
    onEntityAction(pending, entity) {
      calls.push({ pending, entity });
    },
  });
  controller.bind();

  await controller.beginEntityAction({ action: "insert", entityType: "citation" });
  refs.explorerList.dispatch("click", {
    closest(selector) {
      if (selector === "[data-explorer-retry]") return null;
      if (selector === "[data-document-id]") return null;
      if (selector === "[data-entity-id]") return { dataset: { entityId: "citation-9" } };
      return null;
    },
  });

  assert.deepEqual(calls, [{
    pending: { action: "insert", entityType: "citation" },
    entity: { type: "citation", id: "citation-9" },
  }]);
});

test("context rail note actions use canonical note creation routes", async () => {
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: "project-1",
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const requests = [];
  const noteActions = createNoteActions({
    researchApi: {
      async createNote(payload) {
        requests.push({ type: "selection", payload });
        return { id: "note-1", title: payload.title, note_body: payload.note_body };
      },
      async createNoteFromQuote(quoteId, payload) {
        requests.push({ type: "quote", quoteId, payload });
        return { id: "note-2", title: payload.title, note_body: payload.note_body };
      },
    },
    attachActions: {
      async attachNote(noteId) {
        requests.push({ type: "attach", noteId });
      },
    },
    workspaceState,
    eventBus: { emit() {} },
    stores: { notes: { prime() {} } },
  });

  await noteActions.createNoteFromSelection("Selected evidence for chapter");
  await noteActions.createNoteFromQuote({ id: "quote-1", excerpt: "Quoted evidence" });

  assert.equal(requests[0].type, "selection");
  assert.equal(requests[0].payload.project_id, "project-1");
  assert.equal(requests[1].type, "attach");
  assert.equal(requests[2].type, "quote");
  assert.equal(requests[2].quoteId, "quote-1");
  assert.equal(requests[3].type, "attach");
});
