(function attachCitationsStoreRuntime(global) {
  const runtime = global.WritiorEditorRuntime;
  if (!runtime || typeof runtime.register !== "function") {
    throw new Error("[editor] Runtime core must load before citations store runtime");
  }

  function createCitationsStore() {
    const entities = new Map();
    const renderCache = new Map();
    const library = { ids: [], query: "", loaded: false };

    function upsertMany(citations) {
      (citations || []).forEach((citation) => {
        if (!citation?.id) return;
        entities.set(citation.id, citation);
      });
    }

    function setLibraryResults(query, citations) {
      upsertMany(citations);
      library.query = query || "";
      library.ids = (citations || []).map((citation) => citation.id).filter(Boolean);
      library.loaded = true;
    }

    function getById(id) {
      return entities.get(id) || null;
    }

    function getLibraryCitations() {
      return library.ids.map((id) => entities.get(id)).filter(Boolean);
    }

    function getAttachedCitations(ids) {
      return (ids || []).map((id) => entities.get(id)).filter(Boolean);
    }

    return {
      entities,
      renderCache,
      library,
      upsertMany,
      setLibraryResults,
      getById,
      getLibraryCitations,
      getAttachedCitations,
    };
  }

  runtime.register("citationsStore", createCitationsStore);
})(window);
