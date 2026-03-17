import { apiFetchJson, createLatestRequestTracker } from "../core/fetch.js";
import { renderEmpty, renderError, renderLoading, bindRetry } from "../core/dom.js";
import { getResearchStateFromUrl, updateResearchUrl } from "../core/url_state.js";
import { renderCitationCard, renderNoteCard, renderQuoteCard, renderSourceCard } from "../renderers/cards.js";
import { renderCitationDetail, renderNoteDetail, renderQuoteDetail, renderSourceDetail } from "../renderers/details.js";
import { ensureFeedbackRuntime } from "../../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS } from "../../shared/feedback/feedback_tokens.js";

const TAB_CONFIG = {
  sources: {
    listPath: (state) => `/api/sources?limit=20${state.q ? `&query=${encodeURIComponent(state.q)}` : ""}`,
    detailPath: (id) => `/api/sources/${encodeURIComponent(id)}`,
    listRenderer: renderSourceCard,
    detailRenderer: renderSourceDetail,
    envelope: false,
  },
  citations: {
    listPath: (state) => `/api/citations?limit=20${state.q ? `&search=${encodeURIComponent(state.q)}` : ""}`,
    detailPath: (id) => `/api/citations/${encodeURIComponent(id)}`,
    listRenderer: renderCitationCard,
    detailRenderer: renderCitationDetail,
    envelope: false,
  },
  quotes: {
    listPath: (state) => `/api/quotes?limit=20${state.q ? `&query=${encodeURIComponent(state.q)}` : ""}`,
    detailPath: (id) => `/api/quotes/${encodeURIComponent(id)}`,
    listRenderer: renderQuoteCard,
    detailRenderer: renderQuoteDetail,
    envelope: true,
  },
  notes: {
    listPath: (state) => {
      const parts = [`/api/notes?limit=20`];
      if (state.q) parts.push(`&query=${encodeURIComponent(state.q)}`);
      if (state.project) parts.push(`&project_id=${encodeURIComponent(state.project)}`);
      if (state.tag) parts.push(`&tag_id=${encodeURIComponent(state.tag)}`);
      return parts.join("");
    },
    detailPath: (id) => `/api/notes/${encodeURIComponent(id)}`,
    listRenderer: renderNoteCard,
    detailRenderer: renderNoteDetail,
    envelope: true,
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
  const detailCache = new Map();

  function setContextOpen(isOpen) {
    frame.classList.toggle("has-context", isOpen);
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
    [...tablist.querySelectorAll("[data-tab]")].forEach((button) => {
      const active = button.dataset.tab === state.tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function renderList(items, state) {
    if (!items.length) {
      renderEmpty(listNode, `No ${state.tab} yet`, `Capture or create ${state.tab} to populate this view.`);
      return;
    }
    const renderer = TAB_CONFIG[state.tab].listRenderer;
    listNode.innerHTML = `<div class="card-stack" role="list" aria-label="${state.tab} results">${items.map((item) => renderer(item, { selected: item.id === state.selected })).join("")}</div>`;
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
    renderList(latestListItems, getState());
  }

  async function loadList() {
    const state = getState();
    syncControls(state);
    renderLoading(listNode, `Loading ${state.tab}…`);
    if (listAbortController) listAbortController.abort();
    listAbortController = new AbortController();
    const requestId = listTracker.next();

    try {
      const payload = await apiFetchJson(TAB_CONFIG[state.tab].listPath(state), { signal: listAbortController.signal });
      if (!listTracker.isLatest(requestId)) return;
      activeDatasetKey = datasetKey(state);
      latestListItems = TAB_CONFIG[state.tab].envelope ? (payload || []) : (payload || []);
      feedback.emitDomainEvent(FEEDBACK_EVENTS.RESEARCH_PANEL_READY, { label: `${state.tab} ready` });
      renderList(latestListItems, state);
      if (state.selected) {
        await loadDetail(state.selected);
      } else {
        clearContext();
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
      clearContext();
    }
  }

  function localSelection(state, id) {
    return latestListItems.find((item) => item.id === id) || null;
  }

  function clearContext() {
    contextTitle.textContent = "Select an item";
    contextBody.innerHTML = `<div class="surface-note">The context panel uses list payloads immediately, then enriches with canonical detail only when needed.</div>`;
    setContextOpen(false);
  }

  async function loadDetail(id) {
    const state = getState();
    const config = TAB_CONFIG[state.tab];
    const baseItem = localSelection(state, id);
    if (!baseItem) {
      clearContext();
      return;
    }
    contextTitle.textContent = id;
    contextBody.innerHTML = config.detailRenderer(baseItem);
    setContextOpen(true);

    if (detailCache.has(`${state.tab}:${id}`)) {
      contextBody.innerHTML = config.detailRenderer(detailCache.get(`${state.tab}:${id}`));
      return;
    }

    if (detailAbortController) detailAbortController.abort();
    detailAbortController = new AbortController();
    const requestId = detailTracker.next();

    try {
      const detail = await apiFetchJson(config.detailPath(id), { signal: detailAbortController.signal });
      if (!detailTracker.isLatest(requestId)) return;
      detailCache.set(`${state.tab}:${id}`, detail);
      if (getState().selected !== id || getState().tab !== state.tab) return;
      contextBody.innerHTML = config.detailRenderer(detail);
    } catch (error) {
      if (error.name === "AbortError") return;
      if (!detailTracker.isLatest(requestId)) return;
    }
  }

  function clearSelection() {
    updateResearchUrl({ selected: "" });
    clearContext();
    refreshListSelection();
  }

  function selectItem(id) {
    if (!id || getState().selected === id) {
      return;
    }
    updateResearchUrl({ selected: id });
    refreshListSelection();
    loadDetail(id);
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
    updateResearchUrl({
      q: queryInput.value.trim(),
      project: projectInput.value.trim(),
      tag: tagInput.value.trim(),
      selected: "",
    });
    loadList();
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

  await loadList();
}
