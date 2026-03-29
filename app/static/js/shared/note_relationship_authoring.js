const NOTE_LINK_TYPES = Object.freeze(["supports", "contradicts", "extends", "related"]);
const EVIDENCE_ROLES = Object.freeze(["primary", "supporting", "background"]);

function cloneRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
}

function evidenceKey(row) {
  if (row?.id) return `id:${row.id}`;
  if (row?.citation_id) return `citation:${row.citation_id}`;
  if (row?.source_id) return `source:${row.source_id}`;
  if (row?.url) return `url:${row.url}`;
  return "unknown";
}

function noteTargetRow(note) {
  return {
    id: note.id,
    label: note.title || note.note_body || note.highlight_text || "Untitled note",
    subtitle: note.status || "",
    note,
  };
}

function sourceTargetRow(source) {
  return {
    id: source.id,
    label: source.title || source.canonical_url || "Untitled source",
    subtitle: source.hostname || source.publisher || "",
    source_id: source.id,
    url: source.canonical_url || source.page_url || "",
    hostname: source.hostname || "",
    title: source.title || source.canonical_url || "",
    target_kind: "source",
  };
}

function citationTargetRow(citation) {
  const source = citation?.source || {};
  return {
    id: citation.id,
    label: source.title || citation.excerpt || "Citation",
    subtitle: source.hostname || source.publisher || "",
    citation_id: citation.id,
    source_id: source.id || citation.source_id || null,
    url: source.canonical_url || source.page_url || "",
    hostname: source.hostname || "",
    title: source.title || citation.excerpt || "Citation",
    target_kind: "citation",
  };
}

function buildPreview(panel) {
  if (!panel) return null;
  if (panel.kind === "note_link") {
    const target = panel.selectedTarget;
    if (!target) return null;
    return {
      label: target.label || "Related note",
      detail: `Will link as ${panel.linkType || "related"}.`,
    };
  }
  if (panel.kind === "external_evidence") {
    if (!String(panel.url || "").trim()) return null;
    return {
      label: panel.title || panel.url,
      detail: `Will attach as ${panel.evidenceRole || "supporting"} evidence.`,
    };
  }
  const target = panel.selectedTarget;
  if (!target) return null;
  return {
    label: target.label || "Evidence",
    detail: `Will attach as ${panel.evidenceRole || "supporting"} evidence.`,
  };
}

export function createNoteRelationshipAuthoringController({
  api,
  getNoteDetail,
  onStateChange = () => {},
  onNoteUpdated = async () => {},
  onNavigateToNote = null,
  onNotify = null,
}) {
  const state = {
    ownerChooser: null,
    panel: null,
  };

  function emit() {
    onStateChange(getState());
  }

  function getState() {
    return {
      ownerChooser: state.ownerChooser ? { ...state.ownerChooser } : null,
      panel: state.panel ? { ...state.panel, results: cloneRows(state.panel.results), selectedTarget: state.panel.selectedTarget ? { ...state.panel.selectedTarget } : null } : null,
    };
  }

  function updatePanel(partial) {
    if (!state.panel) return;
    state.panel = {
      ...state.panel,
      ...partial,
    };
    state.panel.preview = buildPreview(state.panel);
    emit();
  }

  function chooserMatches(targetKind, targetId) {
    return state.ownerChooser && state.ownerChooser.targetKind === targetKind && state.ownerChooser.targetId === targetId;
  }

  async function loadOwnerNotes() {
    if (!state.ownerChooser) return;
    state.ownerChooser.pending = true;
    state.ownerChooser.error = "";
    emit();
    try {
      const rows = await api.listNotes({ query: state.ownerChooser.query || "", limit: 12 });
      state.ownerChooser.results = rows.map(noteTargetRow);
    } catch (error) {
      state.ownerChooser.error = error?.message || "Notes could not be loaded.";
    } finally {
      if (state.ownerChooser) {
        state.ownerChooser.pending = false;
      }
      emit();
    }
  }

  async function loadPanelResults() {
    if (!state.panel || state.panel.kind === "external_evidence" || state.panel.selectedTarget) {
      emit();
      return;
    }
    state.panel.pending = true;
    state.panel.error = "";
    emit();
    try {
      if (state.panel.kind === "note_link") {
        const note = await getNoteDetail(state.panel.ownerNoteId);
        const rows = await api.listNotes({
          query: state.panel.query || "",
          projectId: note?.project_id || "",
          limit: 12,
        });
        state.panel.results = rows.filter((row) => row?.id && row.id !== state.panel.ownerNoteId).map(noteTargetRow);
      } else if (state.panel.kind === "source_evidence") {
        const rows = await api.listSources({ query: state.panel.query || "", limit: 12 });
        state.panel.results = rows.map(sourceTargetRow);
      } else if (state.panel.kind === "citation_evidence") {
        const rows = await api.listCitations({ search: state.panel.query || "", limit: 12 });
        state.panel.results = rows.map(citationTargetRow);
      }
    } catch (error) {
      state.panel.error = error?.message || "Choices could not be loaded.";
    } finally {
      if (state.panel) {
        state.panel.pending = false;
        state.panel.preview = buildPreview(state.panel);
      }
      emit();
    }
  }

  async function openPanel(ownerNoteId, kind, initial = {}) {
    state.ownerChooser = null;
    state.panel = {
      ownerNoteId,
      kind,
      query: "",
      results: [],
      pending: false,
      saving: false,
      error: "",
      linkType: initial.linkType || "related",
      evidenceRole: initial.evidenceRole || "supporting",
      selectedTarget: initial.selectedTarget || null,
      editingKey: initial.editingKey || "",
      url: initial.url || "",
      title: initial.title || "",
      preview: null,
    };
    state.panel.preview = buildPreview(state.panel);
    emit();
    await loadPanelResults();
  }

  function closePanel() {
    state.panel = null;
    emit();
  }

  async function openOwnerChooser(target) {
    state.panel = null;
    state.ownerChooser = {
      targetKind: target.targetKind,
      targetId: target.targetId,
      targetLabel: target.targetLabel,
      targetRow: { ...target.targetRow },
      query: "",
      results: [],
      pending: false,
      error: "",
    };
    emit();
    await loadOwnerNotes();
  }

  async function editExistingNoteLink(ownerNoteId, relationKey) {
    const note = await getNoteDetail(ownerNoteId);
    const existing = (note?.note_links || []).find((row) => row.linked_note_id === relationKey);
    const selectedNote = (note?.relationship_groups?.note_links_by_type || {});
    const selectedTarget = Object.values(selectedNote).flat().map((row) => row?.note).find((row) => row?.id === relationKey)
      || (await api.getNote(relationKey));
    await openPanel(ownerNoteId, "note_link", {
      linkType: existing?.link_type || "related",
      selectedTarget: selectedTarget ? noteTargetRow(selectedTarget) : { id: relationKey, label: relationKey, subtitle: "", note: { id: relationKey } },
      editingKey: relationKey,
    });
  }

  async function editExistingEvidence(ownerNoteId, relationKey) {
    const note = await getNoteDetail(ownerNoteId);
    const existing = (note?.evidence_links || []).find((row) => evidenceKey(row) === relationKey);
    if (!existing) return;
    if (existing.citation_id) {
      await openPanel(ownerNoteId, "citation_evidence", {
        evidenceRole: existing.evidence_role || "supporting",
        selectedTarget: {
          id: existing.citation_id,
          label: existing.display?.label || existing.title || existing.citation_id,
          subtitle: existing.display?.subtitle || existing.hostname || "",
          citation_id: existing.citation_id,
          source_id: existing.source_id || null,
          url: existing.url || "",
          hostname: existing.hostname || "",
          title: existing.title || "",
          target_kind: "citation",
        },
        editingKey: relationKey,
      });
      return;
    }
    if (existing.source_id) {
      await openPanel(ownerNoteId, "source_evidence", {
        evidenceRole: existing.evidence_role || "supporting",
        selectedTarget: {
          id: existing.source_id,
          label: existing.display?.label || existing.title || existing.source_id,
          subtitle: existing.display?.subtitle || existing.hostname || "",
          source_id: existing.source_id,
          url: existing.url || "",
          hostname: existing.hostname || "",
          title: existing.title || "",
          target_kind: "source",
        },
        editingKey: relationKey,
      });
      return;
    }
    await openPanel(ownerNoteId, "external_evidence", {
      evidenceRole: existing.evidence_role || "supporting",
      url: existing.url || "",
      title: existing.title || "",
      editingKey: relationKey,
    });
  }

  async function removeNoteLink(ownerNoteId, relationKey) {
    const note = await getNoteDetail(ownerNoteId);
    const nextLinks = cloneRows(note?.note_links).filter((row) => row.linked_note_id !== relationKey);
    try {
      const updated = await api.replaceNoteLinks(ownerNoteId, nextLinks);
      await onNoteUpdated(updated);
      onNotify?.({ kind: "success", message: "Linked note removed.", title: "Linked note removed" });
    } catch (error) {
      updatePanel({ error: error?.message || "The note link could not be removed." });
      onNotify?.({ kind: "error", title: "Linked note removal failed", message: error?.message || "The linked note could not be removed." });
    }
  }

  async function removeEvidence(ownerNoteId, relationKey) {
    const note = await getNoteDetail(ownerNoteId);
    const nextEvidence = cloneRows(note?.evidence_links).filter((row) => evidenceKey(row) !== relationKey);
    try {
      const updated = await api.replaceNoteSources(ownerNoteId, nextEvidence);
      await onNoteUpdated(updated);
      onNotify?.({ kind: "success", message: "Attached evidence removed.", title: "Attached evidence removed" });
    } catch (error) {
      updatePanel({ error: error?.message || "The evidence link could not be removed." });
      onNotify?.({ kind: "error", title: "Evidence removal failed", message: error?.message || "The attached evidence could not be removed." });
    }
  }

  async function savePanel() {
    if (!state.panel) return;
    const panel = state.panel;
    if (panel.kind === "note_link" && !NOTE_LINK_TYPES.includes(panel.linkType)) {
      updatePanel({ error: "Invalid note link type" });
      return;
    }
    if (panel.kind !== "note_link" && !EVIDENCE_ROLES.includes(panel.evidenceRole)) {
      updatePanel({ error: "Invalid note evidence role" });
      return;
    }
    if (panel.kind !== "external_evidence" && !panel.selectedTarget) {
      updatePanel({ error: "Choose a target before saving." });
      return;
    }
    if (panel.kind === "external_evidence" && !String(panel.url || "").trim()) {
      updatePanel({ error: "Enter a supporting URL before saving." });
      return;
    }

    const note = await getNoteDetail(panel.ownerNoteId);
    updatePanel({ saving: true, error: "" });
    try {
      if (panel.kind === "note_link") {
        const nextLinks = cloneRows(note?.note_links).filter((row) => row.linked_note_id !== panel.editingKey && row.linked_note_id !== panel.selectedTarget.id);
        nextLinks.push({ linked_note_id: panel.selectedTarget.id, link_type: panel.linkType });
        const updated = await api.replaceNoteLinks(panel.ownerNoteId, nextLinks);
        await onNoteUpdated(updated);
        onNotify?.({ kind: "success", message: "Note linked.", title: "Note linked" });
      } else {
        const nextEvidence = cloneRows(note?.evidence_links).filter((row) => evidenceKey(row) !== panel.editingKey);
        if (panel.kind === "external_evidence") {
          nextEvidence.push({
            target_kind: "external",
            evidence_role: panel.evidenceRole,
            url: String(panel.url || "").trim(),
            title: String(panel.title || "").trim(),
          });
        } else {
          nextEvidence.push({
            target_kind: panel.kind === "source_evidence" ? "source" : "citation",
            evidence_role: panel.evidenceRole,
            source_id: panel.selectedTarget.source_id || null,
            citation_id: panel.selectedTarget.citation_id || null,
            url: panel.selectedTarget.url || null,
            hostname: panel.selectedTarget.hostname || null,
            title: panel.selectedTarget.title || panel.selectedTarget.label || null,
          });
        }
        const updated = await api.replaceNoteSources(panel.ownerNoteId, nextEvidence);
        await onNoteUpdated(updated);
        onNotify?.({ kind: "success", message: "Evidence attached to note.", title: "Evidence attached" });
      }
      closePanel();
    } catch (error) {
      updatePanel({ saving: false, error: error?.message || "Relationship save failed." });
      onNotify?.({
        kind: "error",
        title: panel.kind === "note_link" ? "Note linking failed" : "Evidence attachment failed",
        message: error?.message || (panel.kind === "note_link" ? "The note could not be linked." : "The evidence could not be attached to the note."),
      });
    }
  }

  return {
    setOnStateChange(nextOnStateChange) {
      onStateChange = typeof nextOnStateChange === "function" ? nextOnStateChange : onStateChange;
    },
    getNoteDetailOptions(note) {
      const panel = state.panel?.ownerNoteId === note?.id ? state.panel : null;
      return {
        authoring: {
          supported: true,
          panel: panel ? { ...panel } : null,
        },
      };
    },
    getSourceDetailOptions(source) {
      return {
        noteHubLink: {
          supported: true,
          targetKind: "source",
          targetId: source?.id || "",
          targetLabel: source?.title || source?.canonical_url || "Source",
          chooser: chooserMatches("source", source?.id || "") ? { ...state.ownerChooser } : null,
        },
      };
    },
    getCitationDetailOptions(citation) {
      return {
        noteHubLink: {
          supported: true,
          targetKind: "citation",
          targetId: citation?.id || "",
          targetLabel: citation?.source?.title || citation?.excerpt || "Citation",
          chooser: chooserMatches("citation", citation?.id || "") ? { ...state.ownerChooser } : null,
        },
      };
    },
    handleChange(dataset, value) {
      if (dataset.noteHubQuery !== undefined && state.ownerChooser) {
        state.ownerChooser.query = value;
        emit();
        return;
      }
      if (!state.panel) return;
      if (dataset.noteAuthoringQuery !== undefined) {
        updatePanel({ query: value });
        return;
      }
      if (dataset.noteAuthoringLinkType !== undefined) {
        updatePanel({ linkType: value });
        return;
      }
      if (dataset.noteAuthoringEvidenceRole !== undefined) {
        updatePanel({ evidenceRole: value });
        return;
      }
      if (dataset.noteAuthoringUrl !== undefined) {
        updatePanel({ url: value });
        return;
      }
      if (dataset.noteAuthoringTitle !== undefined) {
        updatePanel({ title: value });
      }
    },
    async handleClick(dataset) {
      if (dataset.noteHubLinkOpen) {
        if (dataset.noteHubLinkOpen === "source") {
          await openOwnerChooser({
            targetKind: "source",
            targetId: dataset.targetId || "",
            targetLabel: dataset.targetLabel || "Source",
            targetRow: {
              id: dataset.targetId || "",
              label: dataset.targetLabel || "Source",
              subtitle: dataset.targetSubtitle || "",
              source_id: dataset.targetId || "",
              url: dataset.targetUrl || "",
              hostname: dataset.targetHostname || "",
              title: dataset.targetLabel || "",
              target_kind: "source",
            },
          });
        } else if (dataset.noteHubLinkOpen === "citation") {
          await openOwnerChooser({
            targetKind: "citation",
            targetId: dataset.targetId || "",
            targetLabel: dataset.targetLabel || "Citation",
            targetRow: {
              id: dataset.targetId || "",
              label: dataset.targetLabel || "Citation",
              subtitle: dataset.targetSubtitle || "",
              citation_id: dataset.targetId || "",
              source_id: dataset.sourceId || "",
              url: dataset.targetUrl || "",
              hostname: dataset.targetHostname || "",
              title: dataset.targetLabel || "",
              target_kind: "citation",
            },
          });
        }
        return true;
      }
      if (dataset.noteHubSearch !== undefined) {
        await loadOwnerNotes();
        return true;
      }
      if (dataset.noteHubCancel !== undefined) {
        state.ownerChooser = null;
        emit();
        return true;
      }
      if (dataset.noteHubNotePick && state.ownerChooser) {
        const ownerNoteId = dataset.noteHubNotePick;
        const chooser = state.ownerChooser;
        state.ownerChooser = null;
        await openPanel(ownerNoteId, chooser.targetKind === "source" ? "source_evidence" : "citation_evidence", {
          selectedTarget: chooser.targetRow,
        });
        if (typeof onNavigateToNote === "function") {
          await onNavigateToNote(ownerNoteId);
        }
        return true;
      }
      if (dataset.noteAuthoringOpen) {
        await openPanel(dataset.noteId || "", dataset.noteAuthoringOpen);
        return true;
      }
      if (dataset.noteAuthoringSearch !== undefined) {
        await loadPanelResults();
        return true;
      }
      if (dataset.noteAuthoringTarget && state.panel) {
        const match = (state.panel.results || []).find((row) => row.id === dataset.noteAuthoringTarget);
        if (match) {
          updatePanel({ selectedTarget: { ...match } });
        }
        return true;
      }
      if (dataset.noteAuthoringCancel !== undefined) {
        closePanel();
        return true;
      }
      if (dataset.noteAuthoringSave !== undefined) {
        await savePanel();
        return true;
      }
      if (dataset.noteRelationEdit === "note-link") {
        await editExistingNoteLink(dataset.noteId || "", dataset.relationKey || "");
        return true;
      }
      if (dataset.noteRelationEdit === "evidence") {
        await editExistingEvidence(dataset.noteId || "", dataset.relationKey || "");
        return true;
      }
      if (dataset.noteRelationRemove === "note-link") {
        await removeNoteLink(dataset.noteId || "", dataset.relationKey || "");
        return true;
      }
      if (dataset.noteRelationRemove === "evidence") {
        await removeEvidence(dataset.noteId || "", dataset.relationKey || "");
        return true;
      }
      return false;
    },
  };
}
