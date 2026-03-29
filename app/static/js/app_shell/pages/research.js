import { apiFetchJson, createLatestRequestTracker } from "../core/fetch.js";
import { renderEmpty, renderError, renderLoading, bindRetry } from "../core/dom.js";
import { getResearchStateFromUrl, updateResearchUrl } from "../core/url_state.js";
import { renderCitationCard, renderNoteCard, renderQuoteCard, renderSourceCard } from "../renderers/cards.js";
import { renderCitationDetail, renderGraphDetail, renderNoteDetail, renderQuoteDetail, renderSourceDetail } from "../renderers/details.js";
import { mergeCitationRenderPayload, resolveCitationView } from "../../shared/citation_contract.js";
import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS } from "../../shared/feedback/feedback_tokens.js";
import { createNoteRelationshipAuthoringController } from "../../shared/note_relationship_authoring.js";
import { convertQuoteToNote, mergeConvertedNoteIntoQuote } from "../../shared/quote_note_conversion.js";

const TAB_CONFIG = {
  sources: {
    listPath: (state, cursor = "") => `/api/sources?limit=20${state.q ? `&query=${encodeURIComponent(state.q)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    listRenderer: renderSourceCard,
    detailRenderer: renderSourceDetail,
    supportsProject: false,
    supportsTag: false,
  },
  citations: {
    listPath: (state, cursor = "") => `/api/citations?limit=20${state.q ? `&search=${encodeURIComponent(state.q)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    listRenderer: renderCitationCard,
    detailRenderer: renderCitationDetail,
    supportsProject: false,
    supportsTag: false,
  },
  quotes: {
    listPath: (state, cursor = "") => `/api/quotes?limit=20${state.q ? `&query=${encodeURIComponent(state.q)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    listRenderer: renderQuoteCard,
    detailRenderer: renderQuoteDetail,
    supportsProject: false,
    supportsTag: false,
  },
  notes: {
    listPath: (state, cursor = "") => {
      const parts = [`/api/notes?limit=20`];
      if (state.q) parts.push(`&query=${encodeURIComponent(state.q)}`);
      if (state.project) parts.push(`&project_id=${encodeURIComponent(state.project)}`);
      if (state.tag) parts.push(`&tag_id=${encodeURIComponent(state.tag)}`);
      if (cursor) parts.push(`&cursor=${encodeURIComponent(cursor)}`);
      return parts.join("");
    },
    listRenderer: renderNoteCard,
    detailRenderer: renderNoteDetail,
    supportsProject: true,
    supportsTag: true,
  },
};

let booted = false;

export async function initResearch() {
  if (booted) return;
  booted = true;
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });

  const listNode = document.getElementById("research-list-region");
  const contextPanel = document.getElementById("research-context-panel");
  const contextBody = document.getElementById("research-context-body");
  const contextTitle = document.getElementById("research-context-title");
  const tablist = document.getElementById("research-tablist");
  const filtersForm = document.getElementById("research-filters");
  const queryInput = document.getElementById("research-query");
  const projectInput = document.getElementById("research-project-filter");
  const tagInput = document.getElementById("research-tag-filter");
  const closeButton = document.getElementById("research-context-close");
  const frame = document.querySelector(".app-content-frame");

  const listTracker = createLatestRequestTracker();
  const detailTracker = createLatestRequestTracker();
  let listAbortController = null;
  let detailAbortController = null;
  let latestListItems = [];
  let activeDatasetKey = "";
  let currentMeta = { has_more: false, next_cursor: null };
  const graphCache = new Map();
  const citationViewState = new Map();
  let lastDetailId = "";
  let lastDetailType = "";
  const relationshipAuthoring = createNoteRelationshipAuthoringController({
    api: {
      listNotes({ query = "", projectId = "", limit = 12 } = {}) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (query) params.set("query", query);
        if (projectId) params.set("project_id", projectId);
        return window.webUnlockerAuth.authJson(`/api/notes?${params.toString()}`, { method: "GET" });
      },
      getNote(noteId) {
        return window.webUnlockerAuth.authJson(`/api/notes/${encodeURIComponent(noteId)}`, { method: "GET" });
      },
      listSources({ query = "", limit = 12 } = {}) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (query) params.set("query", query);
        return window.webUnlockerAuth.authJson(`/api/sources?${params.toString()}`, { method: "GET" });
      },
      listCitations({ search = "", limit = 12 } = {}) {
        const params = new URLSearchParams({ limit: String(limit) });
        if (search) params.set("search", search);
        return window.webUnlockerAuth.authJson(`/api/citations?${params.toString()}`, { method: "GET" });
      },
      replaceNoteLinks(noteId, noteLinks) {
        return window.webUnlockerAuth.authJson(`/api/notes/${encodeURIComponent(noteId)}/links`, {
          method: "PUT",
          body: { note_links: noteLinks },
        });
      },
      replaceNoteSources(noteId, evidenceLinks) {
        return window.webUnlockerAuth.authJson(`/api/notes/${encodeURIComponent(noteId)}/sources`, {
          method: "PUT",
          body: { evidence_links: evidenceLinks },
        });
      },
    },
    getNoteDetail(noteId) {
      return window.webUnlockerAuth.authJson(`/api/notes/${encodeURIComponent(noteId)}`, { method: "GET" });
    },
    onStateChange() {
      renderCurrentContext();
    },
    async onNavigateToNote(noteId) {
      navigateToEntity("note", noteId);
    },
    async onNoteUpdated(note) {
      latestListItems = latestListItems.map((item) => (item?.id === note?.id ? note : item));
      for (const [cacheKey, graph] of graphCache.entries()) {
        if (graph?.node?.type === "note" && graph?.node?.data?.id === note?.id) {
          graph.node.data = note;
          graphCache.set(cacheKey, graph);
        }
        if (Array.isArray(graph?.collections?.notes)) {
          graph.collections.notes = graph.collections.notes.map((row) => (row?.id === note?.id ? note : row));
          graphCache.set(cacheKey, graph);
        }
      }
      renderCurrentContext();
      refreshListSelection();
    },
    onNotify(event) {
      if (event?.kind === "success") {
        feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_READY, { label: event.message || "Relationship saved" });
        return;
      }
      feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
        title: "Relationship update failed",
        message: event?.message || "The note relationship update failed.",
      });
    },
  });

  function setContextOpen(isOpen) {
    frame.classList.toggle("has-context", isOpen);
  }

  function activeConfig(state = getState()) {
    return TAB_CONFIG[state.tab];
  }

  function tabEntityType(tab) {
    return tab.slice(0, -1);
  }

  function getState() {
    const urlState = getResearchStateFromUrl();
    return {
      tab: TAB_CONFIG[urlState.tab] ? urlState.tab : "sources",
      project: urlState.project || "",
      tag: urlState.tag || "",
      q: urlState.q || "",
      selected: urlState.selected || "",
    };
  }

  function syncControls(state) {
    queryInput.value = state.q;
    projectInput.value = state.project;
    tagInput.value = state.tag;
    const config = activeConfig(state);
    projectInput.disabled = !config.supportsProject;
    tagInput.disabled = !config.supportsTag;
    projectInput.placeholder = config.supportsProject ? "Project id" : "Project scope not available here";
    tagInput.placeholder = config.supportsTag ? "Tag id" : "Tag scope not available here";
    [...tablist.querySelectorAll("[data-tab]")].forEach((button) => {
      const active = button.dataset.tab === state.tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function renderLoadMore(meta) {
    if (!meta?.has_more || !meta?.next_cursor) return "";
    return `
      <div class="surface-note">
        <button type="button" class="app-button-secondary" data-research-load-more>Load more</button>
      </div>
    `;
  }

  function renderList(items, state, meta = currentMeta) {
    if (!items.length) {
      renderEmpty(listNode, `No ${state.tab} yet`, `Capture or create ${state.tab} to populate this view.`);
      return;
    }
    const renderer = TAB_CONFIG[state.tab].listRenderer;
    listNode.innerHTML = `<div class="card-stack" role="list" aria-label="${state.tab} results">${items.map((item) => renderer(item, { selected: item.id === state.selected })).join("")}</div>${renderLoadMore(meta)}`;
    const cards = [...listNode.querySelectorAll(".research-card")];
    cards.forEach((card, index) => {
      card.addEventListener("click", () => selectItem(cards[index].dataset.entityId || ""));
      card.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && cards[index + 1]) {
          event.preventDefault();
          cards[index + 1].focus();
        } else if (event.key === "ArrowUp" && cards[index - 1]) {
          event.preventDefault();
          cards[index - 1].focus();
        } else if (event.key === "Enter") {
          event.preventDefault();
          selectItem(cards[index].dataset.entityId || "");
        } else if (event.key === "Escape") {
          event.preventDefault();
          clearSelection();
        }
      });
    });
    const loadMoreButton = listNode.querySelector("[data-research-load-more]");
    if (loadMoreButton) {
      loadMoreButton.addEventListener("click", () => loadMore());
    }
  }

  function datasetKey(state) {
    return JSON.stringify({
      tab: state.tab,
      project: state.project,
      tag: state.tag,
      q: state.q,
    });
  }

  function refreshListSelection() {
    renderList(latestListItems, getState(), currentMeta);
  }

  async function loadList({ append = false, cursor = "" } = {}) {
    const state = getState();
    syncControls(state);
    if (!append) {
      renderLoading(listNode, `Loading ${state.tab}…`);
    }
    if (listAbortController) listAbortController.abort();
    listAbortController = new AbortController();
    const requestId = listTracker.next();

    try {
      const payload = await apiFetchJson(TAB_CONFIG[state.tab].listPath(state, cursor), {
        signal: listAbortController.signal,
        unwrapEnvelope: false,
      });
      if (!listTracker.isLatest(requestId)) return;
      activeDatasetKey = datasetKey(state);
      currentMeta = payload?.meta || { has_more: false, next_cursor: null };
      const nextItems = payload?.data || [];
      latestListItems = append ? [...latestListItems, ...nextItems] : nextItems;
      const selectedId = latestListItems.some((item) => item.id === state.selected)
        ? state.selected
        : (latestListItems[0]?.id || "");
      if (selectedId !== state.selected) {
        updateResearchUrl({ selected: selectedId }, { replace: true });
      }
      const nextState = getState();
      feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_READY, { label: `${state.tab} ready` });
      renderList(latestListItems, nextState, currentMeta);
      if (selectedId) {
        await loadDetail(selectedId);
      } else {
        clearContext(nextState);
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      if (!listTracker.isLatest(requestId)) return;
      feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
        title: `Unable to load ${state.tab}`,
        message: error.message || `Failed to load ${state.tab}.`,
      });
      renderError(listNode, error.message || `Failed to load ${state.tab}.`);
      bindRetry(listNode, loadList);
      clearContext(state);
    }
  }

  async function loadMore() {
    if (!currentMeta?.has_more || !currentMeta?.next_cursor) return;
    await loadList({ append: true, cursor: currentMeta.next_cursor });
  }

  function localSelection(state, id) {
    return latestListItems.find((item) => item.id === id) || null;
  }

  function clearContext(state = getState()) {
    const singularLabel = tabEntityType(state.tab);
    contextTitle.textContent = `Active ${singularLabel}`;
    contextBody.innerHTML = `
      <section class="detail-section">
        <p class="section-kicker">Context panel</p>
        <h3>No active ${singularLabel}</h3>
        <p class="detail-copy">Select a ${singularLabel} to inspect its connected citations, quotes, notes, documents, and sources where available.</p>
      </section>
      <section class="detail-section">
        <p class="section-kicker">Current state</p>
        <div class="surface-note">No ${state.tab} match the current view yet.</div>
      </section>
    `;
    setContextOpen(true);
  }

  function renderContextLoading(id, fallbackDetail) {
    contextTitle.textContent = `Active ${tabEntityType(getState().tab)}`;
    contextBody.innerHTML = `${fallbackDetail}<div class="surface-note">Loading related research neighborhood…</div>`;
    setContextOpen(true);
  }

  function graphPath(type, id) {
    return `/api/research/${encodeURIComponent(type)}/${encodeURIComponent(id)}/graph`;
  }

  async function requestCitationRender(citationId, style) {
    return window.webUnlockerAuth.authJson("/api/citations/render", {
      method: "POST",
      body: {
        citation_id: citationId,
        style,
      },
    });
  }

  function mergeGraphCitation(citationId, payload) {
    latestListItems = latestListItems.map((item) => (
      item?.id === citationId ? mergeCitationRenderPayload(item, payload) : item
    ));
    for (const [cacheKey, graph] of graphCache.entries()) {
      if (graph?.node?.type === "citation" && graph?.node?.data?.id === citationId) {
        graph.node.data = mergeCitationRenderPayload(graph.node.data, payload);
      }
      if (Array.isArray(graph?.collections?.citations)) {
        graph.collections.citations = graph.collections.citations.map((citation) => (
          citation?.id === citationId ? mergeCitationRenderPayload(citation, payload) : citation
        ));
      }
      graphCache.set(cacheKey, graph);
    }
  }

  function renderCurrentContext() {
    const state = getState();
    const selectedId = state.selected;
    if (!selectedId) {
      clearContext(state);
      return;
    }
    contextTitle.textContent = `Active ${tabEntityType(state.tab)}`;
    const cacheKey = `${state.tab}:${selectedId}`;
    if (graphCache.has(cacheKey)) {
      contextBody.innerHTML = renderGraphDetail(graphCache.get(cacheKey), {
        citationViewState,
        detailOptions: buildDetailOptions(graphCache.get(cacheKey)),
      });
      return;
    }
    const baseItem = localSelection(state, selectedId);
    if (state.tab === "citations" && baseItem) {
      contextBody.innerHTML = renderCitationDetail(baseItem, {
        citationView: citationViewState.get(baseItem.id) || {},
        ...relationshipAuthoring.getCitationDetailOptions(baseItem),
      });
      return;
    }
    if (state.tab === "sources" && baseItem) {
      contextBody.innerHTML = renderSourceDetail(baseItem, relationshipAuthoring.getSourceDetailOptions(baseItem));
      return;
    }
    if (state.tab === "notes" && baseItem) {
      contextBody.innerHTML = renderNoteDetail(baseItem, relationshipAuthoring.getNoteDetailOptions(baseItem));
      return;
    }
    if (baseItem) {
      contextBody.innerHTML = TAB_CONFIG[state.tab].detailRenderer(
        baseItem,
        state.tab === "quotes"
          ? {
            convertAction: {
              supported: !!baseItem?.id,
              label: "Convert to note",
            },
            derivedNotes: baseItem?.neighborhood?.notes || [],
          }
          : {},
      );
    }
  }

  function buildDetailOptions(graph) {
    const node = graph?.node || {};
    const current = node.data || {};
    return {
      source: node.type === "source" ? relationshipAuthoring.getSourceDetailOptions(current) : {},
      citation: node.type === "citation" ? relationshipAuthoring.getCitationDetailOptions(current) : {},
      quote: node.type === "quote" ? {
        convertAction: {
          supported: !!current?.id,
          label: "Convert to note",
        },
        derivedNotes: graph?.collections?.notes || current?.neighborhood?.notes || [],
      } : {},
      note: node.type === "note" ? relationshipAuthoring.getNoteDetailOptions(current) : {},
    };
  }

  function getCurrentQuoteDetail(quoteId) {
    const state = getState();
    const graph = graphCache.get(`${state.tab}:${quoteId}`);
    if (graph?.node?.type === "quote") return graph.node.data;
    return latestListItems.find((item) => item?.id === quoteId) || null;
  }

  function openConvertedNote(note) {
    if (!note?.id) return;
    latestListItems = [note];
    currentMeta = { has_more: false, next_cursor: null };
    updateResearchUrl({
      tab: "notes",
      selected: note.id,
      q: "",
      project: "",
      tag: "",
    });
    syncControls(getState());
    renderList(latestListItems, getState(), currentMeta);
    contextBody.innerHTML = renderNoteDetail(note, relationshipAuthoring.getNoteDetailOptions(note));
    setContextOpen(true);
    void loadDetail(note.id);
    void loadList();
  }

  async function handleContextAction(dataset) {
    if (dataset.contextAction !== "convert-quote-to-note" || !dataset.quoteId) return false;
    const quote = getCurrentQuoteDetail(dataset.quoteId);
    const result = await convertQuoteToNote({
      quote,
      researchApi: {
        createNoteFromQuote(quoteId, payload) {
          return window.webUnlockerAuth.authJson(`/api/quotes/${encodeURIComponent(quoteId)}/notes`, {
            method: "POST",
            body: payload,
          });
        },
      },
      feedback,
    });
    if (!result?.note) return true;

    latestListItems = latestListItems.map((item) => (
      item?.id === result.quote?.id ? mergeConvertedNoteIntoQuote(item, result.note) : item
    ));
    const quoteCacheKey = `quotes:${result.quote?.id || dataset.quoteId}`;
    const cachedQuoteGraph = graphCache.get(quoteCacheKey);
    if (cachedQuoteGraph?.node?.type === "quote") {
      graphCache.set(quoteCacheKey, {
        ...cachedQuoteGraph,
        node: {
          ...cachedQuoteGraph.node,
          data: result.quote,
        },
        collections: {
          ...(cachedQuoteGraph.collections || {}),
          notes: [...(cachedQuoteGraph.collections?.notes || []), result.note],
        },
      });
    }
    openConvertedNote(result.note);
    return true;
  }

  async function loadDetail(id) {
    const state = getState();
    const config = TAB_CONFIG[state.tab];
    const baseItem = localSelection(state, id);
    const baseMarkup = state.tab === "citations"
      ? config.detailRenderer(baseItem || { id, title: id }, {
        citationView: citationViewState.get(id) || {},
      })
      : config.detailRenderer(
        baseItem || { id, title: id },
        state.tab === "quotes"
          ? {
            convertAction: {
              supported: !!id,
              label: "Convert to note",
            },
            derivedNotes: baseItem?.neighborhood?.notes || [],
          }
          : {},
      );
    renderContextLoading(id, baseMarkup);
    lastDetailId = id;
    lastDetailType = tabEntityType(state.tab);

    if (graphCache.has(`${state.tab}:${id}`)) {
      contextBody.innerHTML = renderGraphDetail(graphCache.get(`${state.tab}:${id}`), {
        citationViewState,
        detailOptions: buildDetailOptions(graphCache.get(`${state.tab}:${id}`)),
      });
      return;
    }

    if (detailAbortController) detailAbortController.abort();
    detailAbortController = new AbortController();
    const requestId = detailTracker.next();

    try {
      const graph = await apiFetchJson(graphPath(tabEntityType(state.tab), id), { signal: detailAbortController.signal });
      if (!detailTracker.isLatest(requestId)) return;
      graphCache.set(`${state.tab}:${id}`, graph);
      if (getState().selected !== id || getState().tab !== state.tab) return;
      contextBody.innerHTML = renderGraphDetail(graph, {
        citationViewState,
        detailOptions: buildDetailOptions(graph),
      });
    } catch (error) {
      if (error.name === "AbortError") return;
      if (!detailTracker.isLatest(requestId)) return;
      contextBody.innerHTML = `${baseMarkup}<div class="surface-note">Unable to load the canonical neighborhood right now.</div>`;
    }
  }

  function clearSelection() {
    const fallbackId = latestListItems[0]?.id || "";
    updateResearchUrl({ selected: fallbackId }, { replace: true });
    refreshListSelection();
    if (fallbackId) {
      void loadDetail(fallbackId);
      return;
    }
    clearContext();
  }

  function selectItem(id) {
    if (!id || getState().selected === id) {
      return;
    }
    updateResearchUrl({ selected: id });
    refreshListSelection();
    loadDetail(id);
  }

  function navigateToEntity(type, id) {
    const nextTab = `${type}s`;
    const nextState = {
      tab: nextTab,
      selected: id,
      q: "",
      project: nextTab === "notes" ? getState().project : "",
      tag: nextTab === "notes" ? getState().tag : "",
    };
    updateResearchUrl(nextState);
    if (nextTab === getState().tab) {
      refreshListSelection();
      void loadDetail(id);
      return;
    }
    void loadList();
  }

  function navigateToDocument(documentId) {
    window.location.href = `/editor?document_id=${encodeURIComponent(documentId)}`;
  }

  tablist.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    updateResearchUrl({ tab: button.dataset.tab, selected: "" });
    loadList();
  });

  tablist.addEventListener("keydown", (event) => {
    const tabs = [...tablist.querySelectorAll("[data-tab]")];
    const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
    if (currentIndex === -1) {
      return;
    }
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  });

  filtersForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const config = activeConfig();
    updateResearchUrl({
      q: queryInput.value.trim(),
      project: config.supportsProject ? projectInput.value.trim() : "",
      tag: config.supportsTag ? tagInput.value.trim() : "",
      selected: getState().selected,
    });
    loadList();
  });

  contextBody.addEventListener("click", (event) => {
    const contextAction = event.target.closest("[data-context-action]");
    if (contextAction) {
      void handleContextAction(contextAction.dataset);
      return;
    }
    const action = event.target.closest("[data-note-hub-link-open],[data-note-hub-search],[data-note-hub-cancel],[data-note-hub-note-pick],[data-note-authoring-open],[data-note-authoring-search],[data-note-authoring-target],[data-note-authoring-save],[data-note-authoring-cancel],[data-note-relation-edit],[data-note-relation-remove]");
    if (action) {
      void relationshipAuthoring.handleClick(action.dataset);
      return;
    }
    const copyButton = event.target.closest("[data-citation-copy]");
    if (copyButton) {
      const citationId = copyButton.dataset.citationCopy || "";
      const state = getState();
      const graph = graphCache.get(`${state.tab}:${citationId}`);
      const citation = graph?.node?.type === "citation"
        ? graph.node.data
        : latestListItems.find((item) => item.id === citationId);
      const text = citation ? resolveCitationView(citation, citationViewState.get(citationId) || {}).text : "";
      navigator.clipboard.writeText(text || "").then(() => {
        feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_READY, { label: "Citation copied" });
      }).catch((error) => {
        feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_FAILED, {
          title: "Copy failed",
          message: error?.message || "Citation copy failed.",
        });
      });
      return;
    }
    const relatedEntity = event.target.closest("[data-related-entity-id]");
    if (relatedEntity) {
      navigateToEntity(relatedEntity.dataset.relatedEntityType || "", relatedEntity.dataset.relatedEntityId || "");
      return;
    }
    const relatedDocument = event.target.closest("[data-related-document-id]");
    if (relatedDocument) {
      navigateToDocument(relatedDocument.dataset.relatedDocumentId || "");
    }
  });
  contextBody.addEventListener("change", async (event) => {
    const authoringField = event.target.closest("[data-note-hub-query],[data-note-authoring-query],[data-note-authoring-link-type],[data-note-authoring-evidence-role],[data-note-authoring-url],[data-note-authoring-title]");
    if (authoringField) {
      relationshipAuthoring.handleChange(authoringField.dataset, authoringField.value);
      return;
    }
    const styleSelect = event.target.closest("[data-citation-style-select]");
    const kindSelect = event.target.closest("[data-citation-kind-select]");
    const citationId = styleSelect?.dataset?.citationStyleSelect || kindSelect?.dataset?.citationKindSelect || "";
    if (!citationId) return;
    const nextView = { ...(citationViewState.get(citationId) || {}) };
    if (kindSelect) {
      nextView.kind = kindSelect.value;
      nextView.message = "";
      citationViewState.set(citationId, nextView);
      renderCurrentContext();
      refreshListSelection();
      return;
    }
    nextView.style = styleSelect.value;
    nextView.loading = true;
    nextView.message = "Loading backend citation render…";
    citationViewState.set(citationId, nextView);
    renderCurrentContext();
    try {
      const payload = await requestCitationRender(citationId, nextView.style);
      mergeGraphCitation(citationId, payload);
      citationViewState.set(citationId, {
        ...nextView,
        loading: false,
        message: "",
      });
    } catch (error) {
      citationViewState.set(citationId, {
        ...nextView,
        loading: false,
        message: error?.message || "Citation render unavailable.",
      });
    }
    renderCurrentContext();
    refreshListSelection();
  });

  closeButton.addEventListener("click", clearSelection);
  window.addEventListener("popstate", () => {
    const state = getState();
    if (datasetKey(state) === activeDatasetKey && latestListItems.length) {
      syncControls(state);
      refreshListSelection();
      if (state.selected) {
        loadDetail(state.selected);
      } else {
        clearContext();
      }
      return;
    }
    loadList();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && getState().selected) {
      clearSelection();
    }
  });

  clearContext(getState());
  await loadList();
}
