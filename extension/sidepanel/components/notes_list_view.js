import { createHoverPreview } from "./hover_preview.js";

export function createNotesListView({
  documentRef = globalThis.document,
  notes = [],
  selectedNoteId = null,
  actionAvailability = {},
  onExpand,
  onCopy,
  onWorkInEditor,
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-notes-list-view", "true");
  root.style.display = "grid";
  root.style.gap = "12px";
  root.style.position = "relative";

  const header = documentRef.createElement("div");
  header.textContent = "Notes";
  header.style.fontSize = "13px";
  header.style.textTransform = "uppercase";
  header.style.letterSpacing = "0.08em";
  header.style.color = "#94a3b8";

  const list = documentRef.createElement("div");
  list.style.display = "grid";
  list.style.gap = "10px";
  const hoverPreview = createHoverPreview({
    documentRef,
    label: "Note preview",
    emptyText: "Hover or focus a note to preview the saved text.",
  });

  function render(nextNotes = notes, nextSelectedNoteId = selectedNoteId) {
    list.innerHTML = "";
    if (!nextNotes.length) {
      const empty = documentRef.createElement("div");
      empty.textContent = "No recent notes yet.";
      empty.style.color = "#94a3b8";
      list.appendChild(empty);
      return;
    }
    for (const note of nextNotes) {
      const row = documentRef.createElement("section");
      row.setAttribute("data-note-id", note.id || "");
      row.setAttribute("tabindex", "0");
      row.setAttribute("role", "button");
      row.style.display = "grid";
      row.style.gap = "8px";
      row.style.padding = "12px";
      row.style.borderRadius = "16px";
      row.style.border = note.id === nextSelectedNoteId ? "1px solid rgba(14, 165, 233, 0.5)" : "1px solid rgba(148, 163, 184, 0.16)";
      row.style.background = "rgba(15, 23, 42, 0.72)";
      row.style.cursor = "default";

      const title = documentRef.createElement("div");
      title.textContent = note.title || "Untitled note";
      title.style.fontSize = "14px";
      title.style.fontWeight = "700";
      title.style.color = "#f8fafc";
      title.style.overflowWrap = "anywhere";

      const body = documentRef.createElement("div");
      body.textContent = note.note_body || note.highlight_text || "";
      body.style.whiteSpace = "pre-wrap";
      body.style.wordBreak = "break-word";
      body.style.overflowWrap = "anywhere";
      body.style.color = "#cbd5e1";

      const actions = documentRef.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.flexWrap = "wrap";

      const expand = documentRef.createElement("button");
      expand.type = "button";
      expand.textContent = note.id === nextSelectedNoteId ? "Collapse" : "Expand";
      expand.style.padding = "7px 10px";
      expand.style.borderRadius = "999px";
      expand.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      expand.style.background = "rgba(15, 23, 42, 0.72)";
      expand.style.color = "#f8fafc";
      expand.addEventListener("click", (event) => {
        event.preventDefault();
        onExpand?.(note);
      });

      const copy = documentRef.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.style.padding = "7px 10px";
      copy.style.borderRadius = "999px";
      copy.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      copy.style.background = "rgba(14, 165, 233, 0.18)";
      copy.style.color = "#f8fafc";
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        onCopy?.({ note, text: body.textContent || "" });
      });

      const workInEditor = documentRef.createElement("button");
      workInEditor.type = "button";
      workInEditor.textContent = "Editor";
      workInEditor.style.padding = "7px 10px";
      workInEditor.style.borderRadius = "999px";
      workInEditor.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      workInEditor.style.background = "rgba(34, 197, 94, 0.16)";
      workInEditor.style.color = "#f8fafc";
      const canWorkInEditor = actionAvailability.work_in_editor !== false;
      if (!canWorkInEditor) {
        workInEditor.disabled = true;
        workInEditor.setAttribute("data-locked", "true");
        workInEditor.setAttribute("aria-disabled", "true");
        workInEditor.style.opacity = "0.5";
        workInEditor.style.cursor = "not-allowed";
      }
      workInEditor.addEventListener("click", (event) => {
        event.preventDefault();
        if (canWorkInEditor) {
          onWorkInEditor?.({ note, text: body.textContent || "" });
        }
      });

      const updatePreview = () => {
        hoverPreview.render({
          label: "Note preview",
          meta: [note.title || "Untitled note", note.highlight_text ? "highlight-backed" : "plain note"].filter(Boolean).join(" • "),
          body: body.textContent || "No preview available.",
        });
      };

      row.addEventListener("mouseenter", updatePreview);
      row.addEventListener("focusin", updatePreview);
      row.addEventListener("mouseleave", () => hoverPreview.clear());
      row.addEventListener("focusout", () => hoverPreview.clear());
      row.addEventListener("keydown", (event) => {
        const key = String(event.key || "").toLowerCase();
        if (key === "enter" || key === " ") {
          event.preventDefault();
          onExpand?.(note);
        }
      });

      actions.appendChild(expand);
      actions.appendChild(copy);
      actions.appendChild(workInEditor);
      row.appendChild(title);
      row.appendChild(body);
      row.appendChild(actions);
      list.appendChild(row);
    }
    hoverPreview.clear();
  }

  render();
  root.appendChild(header);
  root.appendChild(hoverPreview.root);
  root.appendChild(list);

  return {
    root,
    render,
  };
}
