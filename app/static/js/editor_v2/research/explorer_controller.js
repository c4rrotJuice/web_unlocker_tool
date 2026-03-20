export function createExplorerController({
  workspaceState,
  refs,
  renderers,
  hydrator,
  onOpenDocument,
  onFocusEntity,
}) {
  let currentTab = "documents";
  let searchQuery = "";
  const cleanups = [];

  function activeDocumentId() {
    return workspaceState.getState().active_document_id;
  }

  function filteredDocuments() {
    const documents = workspaceState.getState().document_list || [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((document) => {
      const title = (document.title || "").toLowerCase();
      const summary = (document.summary || "").toLowerCase();
      return title.includes(query) || summary.includes(query);
    });
  }

  function renderDocuments() {
    renderers.renderDocumentList(refs.explorerList, filteredDocuments(), activeDocumentId());
  }

  async function refreshExplorer() {
    const heading = currentTab[0].toUpperCase() + currentTab.slice(1);
    refs.explorerHeading.textContent = heading;
    if (currentTab === "documents") {
      renderDocuments();
      const count = filteredDocuments().length;
      refs.explorerStatus.textContent = `${count} ${count === 1 ? "result" : "results"}`;
      return;
    }
    refs.explorerStatus.textContent = "Loading";
    await hydrator.hydrateExplorer(currentTab, { query: searchQuery });
    refs.explorerStatus.textContent = "Ready";
  }

  function bind() {
    cleanups.push(workspaceState.subscribe((state) => {
      if (currentTab !== "documents") return;
      renderers.renderDocumentList(refs.explorerList, filteredDocuments(), state.active_document_id);
      const count = filteredDocuments().length;
      refs.explorerStatus.textContent = `${count} ${count === 1 ? "result" : "results"}`;
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
    const explorerClick = (event) => {
      const documentCard = event.target.closest("[data-document-id]");
      if (documentCard) {
        onOpenDocument(documentCard.dataset.documentId);
        return;
      }
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
