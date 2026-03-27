export function createExplorerController({
  workspaceState,
  refs,
  renderers,
  hydrator,
  onOpenDocument,
  onFocusEntity,
  onEntityAction,
}) {
  let currentTab = "documents";
  let searchQuery = "";
  const cleanups = [];

  function singularType() {
    return currentTab.slice(0, -1);
  }

  function renderExplorerFailure(message) {
    refs.explorerList.innerHTML = `
      <div class="editor-v2-card">
        <h3>${currentTab[0].toUpperCase() + currentTab.slice(1)} unavailable</h3>
        <p>${message}</p>
        <button class="editor-v2-action" type="button" data-explorer-retry="true">Retry</button>
      </div>
    `;
  }

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
    if (currentTab === "documents") {
      renderDocuments();
      const count = filteredDocuments().length;
      refs.explorerStatus.textContent = `${count} ${count === 1 ? "item" : "items"}`;
      return;
    }
    refs.explorerStatus.textContent = "Loading";
    try {
      await hydrator.hydrateExplorer(currentTab, { query: searchQuery });
      const pending = workspaceState.getState().pending_explorer_action;
      refs.explorerStatus.textContent = pending?.entityType === singularType()
        ? `Choose a ${singularType()} to ${pending.action}.`
        : currentTab;
    } catch (error) {
      refs.explorerStatus.textContent = "Unavailable";
      renderExplorerFailure(error?.message || `Failed to load ${currentTab}.`);
    }
  }

  function bind() {
    cleanups.push(workspaceState.subscribe((state) => {
      if (currentTab !== "documents") return;
      renderers.renderDocumentList(refs.explorerList, filteredDocuments(), state.active_document_id);
      const count = filteredDocuments().length;
      refs.explorerStatus.textContent = `${count} ${count === 1 ? "item" : "items"}`;
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
    const activateRow = (event) => {
      const retryButton = event.target.closest("[data-explorer-retry]");
      if (retryButton) {
        void refreshExplorer();
        return;
      }
      const documentCard = event.target.closest("[data-document-id]");
      if (documentCard) {
        onOpenDocument(documentCard.dataset.documentId);
        return;
      }
      const card = event.target.closest("[data-entity-id]");
      if (!card) return;
      const entity = { type: singularType(), id: card.dataset.entityId };
      const pending = workspaceState.getState().pending_explorer_action;
      if (pending?.entityType === entity.type) {
        void onEntityAction?.(pending, entity);
        return;
      }
      onFocusEntity(entity);
    };
    const explorerClick = (event) => activateRow(event);
    const explorerKeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-document-id], [data-entity-id]");
      if (!row) return;
      event.preventDefault();
      activateRow(event);
    };
    refs.explorerList.addEventListener("click", explorerClick);
    refs.explorerList.addEventListener("keydown", explorerKeydown);
    cleanups.push(() => refs.explorerList.removeEventListener("click", explorerClick));
    cleanups.push(() => refs.explorerList.removeEventListener("keydown", explorerKeydown));
  }

  return {
    async prime() {
      await refreshExplorer();
    },
    async beginEntityAction(action) {
      if (!action?.entityType) return;
      currentTab = `${action.entityType}s`;
      workspaceState.setPendingExplorerAction(action);
      refs.explorerTabs.forEach((tab) => {
        const selected = tab.dataset.explorerTab === currentTab;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", selected ? "true" : "false");
      });
      await refreshExplorer();
      refs.explorerSearch.focus();
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
