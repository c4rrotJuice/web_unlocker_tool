import { createNewNoteView, createNotesListView, createStatusView } from "../components/index.ts";

export function renderNoteView(root, snapshot = {}, options = {}) {
  if (!root) {
    return { mounted: false };
  }
  const documentRef = options.documentRef || globalThis.document;
  const wrapper = documentRef.createElement("section");
  wrapper.style.display = "grid";
  wrapper.style.gap = "12px";

  const statusView = createStatusView({
    documentRef,
    title: "Notes",
    message: "Recent notes and the plain note composer live here.",
  });

  const notesList = createNotesListView({
    documentRef,
    notes: snapshot.recent_notes || [],
    selectedNoteId: snapshot.expanded_note_id || null,
    actionAvailability: snapshot.action_availability || {},
    onExpand: options.onExpandNote,
    onCopy: options.onCopyNote,
    onWorkInEditor: options.onWorkInEditorNote,
  });

  const newNoteView = createNewNoteView({
    documentRef,
    draft: snapshot.draft_note || { title: "", body: "" },
    actionAvailability: snapshot.action_availability || {},
    onChange: options.onChangeDraft,
    onSubmit: options.onSubmitNote,
    onWorkInEditor: options.onWorkInEditorDraft,
  });

  function render(nextSnapshot = snapshot) {
    notesList.render(nextSnapshot.recent_notes || [], nextSnapshot.expanded_note_id || null);
    newNoteView.render(nextSnapshot.draft_note || { title: "", body: "" });
    wrapper.innerHTML = "";
    wrapper.appendChild(statusView.root);
    if (nextSnapshot.active_tab === "new_note") {
      wrapper.appendChild(newNoteView.root);
    } else {
      wrapper.appendChild(notesList.root);
    }
  }

  render(snapshot);
  root.innerHTML = "";
  root.appendChild(wrapper);

  return {
    mounted: true,
    render,
  };
}
