export function createExplorerController({
  workspaceState,
  refs,
  renderers,
  hydrator,
  onOpenDocument,
  onFocusEntity,
}) {
  let currentTab = "sources";
  let searchQuery = "";
  const cleanups = [];

  function activeDocumentId() {
    return workspaceState.getState().active_document_id;
  }

  function renderDocuments(documents) {
    renderers.renderDocumentList(refs.documentList, documents, activeDocumentId());
  }

  async function refreshExplorer() {
    refs.explorerStatus.textContent = "Loading";
    await hydrator.hydrateExplorer(currentTab, { query: searchQuery });
    refs.explorerHeading.textContent = currentTab[0].toUpperCase() + currentTab.slice(1);
    refs.explorerStatus.textContent = "Ready";
  }

  function bind() {
    cleanups.push(workspaceState.subscribe((state) => {
      renderDocuments(state.document_list || []);
    }));
    refs.explorerTabs.forEach((button) => {
      const handler = async () => {
        currentTab = button.dataset.explorerTab;
        refs.explorerTabs.forEach((tab) => {
          const selected = tab === button;
          tab.classList.toggle("is-active", selected);
          tab.setAttribute("aria-selected", selected ? "true" : "false");
        });
        await refreshExplorer();
      };
      button.addEventListener("click", handler);
      cleanups.push(() => button.removeEventListener("click", handler));
    });
    const searchHandler = async () => {
      searchQuery = refs.explorerSearch.value.trim();
      await refreshExplorer();
    };
    refs.explorerSearch.addEventListener("input", searchHandler);
    cleanups.push(() => refs.explorerSearch.removeEventListener("input", searchHandler));
    const documentClick = (event) => {
      const card = event.target.closest("[data-document-id]");
      if (!card) return;
      onOpenDocument(card.dataset.documentId);
    };
    refs.documentList.addEventListener("click", documentClick);
    cleanups.push(() => refs.documentList.removeEventListener("click", documentClick));
    const explorerClick = (event) => {
      const card = event.target.closest("[data-entity-id]");
      if (!card) return;
      onFocusEntity({ type: currentTab.slice(0, -1), id: card.dataset.entityId });
    };
    refs.explorerList.addEventListener("click", explorerClick);
    cleanups.push(() => refs.explorerList.removeEventListener("click", explorerClick));
  }

  return {
    async prime() {
      await refreshExplorer();
    },
    renderDocuments,
    bind,
    focusSearch() {
      refs.explorerSearch.focus();
      refs.explorerSearch.select();
    },
    dispose() {
      while (cleanups.length) {
        cleanups.pop()();
      }
    },
  };
}
