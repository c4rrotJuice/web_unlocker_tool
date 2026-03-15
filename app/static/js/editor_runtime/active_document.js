(function attachActiveDocumentRuntime(global) {
  const runtime = global.WritiorEditorRuntime;
  if (!runtime || typeof runtime.register !== "function") {
    throw new Error("[editor] Runtime core must load before active document runtime");
  }

  function cloneValue(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function createActiveDocumentRuntime() {
    const syncStateByDocId = new Map();
    const syncTimersByDocId = new Map();
    const syncInFlightByDocId = new Map();
    const overlaysByDocId = new Map();
    let active = {
      docId: null,
      serverDoc: null,
      effectiveDoc: null,
      dirty: false,
      attachedCitationIds: [],
      readOnly: false,
      lastCheckpointAt: 0,
      changedSinceCheckpoint: 0,
    };

    function getActive() {
      return active;
    }

    function getActiveDocId() {
      return active.docId;
    }

    function resetActive() {
      active = {
        docId: null,
        serverDoc: null,
        effectiveDoc: null,
        dirty: false,
        attachedCitationIds: [],
        readOnly: false,
        lastCheckpointAt: 0,
        changedSinceCheckpoint: 0,
      };
    }

    function setActiveServerDoc(doc, overlay) {
      const effective = overlay?.dirty && overlay?.payload ? {
        ...doc,
        title: overlay.payload.title || doc.title,
        content_delta: overlay.payload.content_delta || doc.content_delta,
        content_html: overlay.payload.content_html || doc.content_html,
        attached_citation_ids: overlay.payload.attached_citation_ids || doc.attached_citation_ids || [],
      } : doc;
      active = {
        ...active,
        docId: doc?.id || null,
        serverDoc: cloneValue(doc),
        effectiveDoc: cloneValue(effective),
        dirty: Boolean(overlay?.dirty),
        attachedCitationIds: (effective?.attached_citation_ids || []).slice(),
        readOnly: Boolean(doc?.archived),
        lastCheckpointAt: Date.now(),
        changedSinceCheckpoint: 0,
      };
      return getActive();
    }

    function stageOverlay(docId, overlay) {
      overlaysByDocId.set(docId, cloneValue(overlay));
      if (active.docId === docId) {
        active = {
          ...active,
          dirty: Boolean(overlay?.dirty),
          effectiveDoc: overlay?.payload ? {
            ...(active.serverDoc || {}),
            ...(active.effectiveDoc || {}),
            title: overlay.payload.title || active.effectiveDoc?.title,
            content_delta: overlay.payload.content_delta || active.effectiveDoc?.content_delta,
            content_html: overlay.payload.content_html || active.effectiveDoc?.content_html,
            attached_citation_ids: overlay.payload.attached_citation_ids || active.attachedCitationIds || [],
          } : active.effectiveDoc,
          attachedCitationIds: (overlay?.payload?.attached_citation_ids || active.attachedCitationIds || []).slice(),
        };
      }
    }

    function getOverlay(docId) {
      return overlaysByDocId.get(docId) || null;
    }

    function clearOverlay(docId) {
      overlaysByDocId.delete(docId);
      if (active.docId === docId) {
        active = { ...active, dirty: false };
      }
    }

    function setDirty(isDirty) {
      active = { ...active, dirty: Boolean(isDirty) };
    }

    function setAttachedCitationIds(ids) {
      active = { ...active, attachedCitationIds: Array.from(new Set(ids || [])) };
      if (active.effectiveDoc) {
        active.effectiveDoc.attached_citation_ids = active.attachedCitationIds.slice();
      }
    }

    function addAttachedCitationId(id) {
      if (!id || active.attachedCitationIds.includes(id)) return active.attachedCitationIds.slice();
      setAttachedCitationIds(active.attachedCitationIds.concat(id));
      return active.attachedCitationIds.slice();
    }

    function removeAttachedCitationId(id) {
      setAttachedCitationIds(active.attachedCitationIds.filter((value) => value !== id));
      return active.attachedCitationIds.slice();
    }

    function setCheckpointState(next) {
      active = {
        ...active,
        lastCheckpointAt: next.lastCheckpointAt == null ? active.lastCheckpointAt : next.lastCheckpointAt,
        changedSinceCheckpoint: next.changedSinceCheckpoint == null ? active.changedSinceCheckpoint : next.changedSinceCheckpoint,
      };
    }

    return {
      getActive,
      getActiveDocId,
      resetActive,
      setActiveServerDoc,
      stageOverlay,
      getOverlay,
      clearOverlay,
      setDirty,
      setAttachedCitationIds,
      addAttachedCitationId,
      removeAttachedCitationId,
      setCheckpointState,
      syncStateByDocId,
      syncTimersByDocId,
      syncInFlightByDocId,
    };
  }

  runtime.register("activeDocument", createActiveDocumentRuntime);
})(window);
