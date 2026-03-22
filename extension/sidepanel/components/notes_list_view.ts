import { createEmptyStateCard } from "./empty_state_card.ts";
import { createHoverPreview } from "./hover_preview.ts";

function getNoteSummary(note, expanded) {
  const pieces = [note.note_body || "", note.highlight_text ? `Highlight: ${note.highlight_text}` : "", note.source?.title || note.page_title || ""]
    .filter(Boolean);
  const text = pieces.join("\n\n") || "No note body available.";
  return expanded ? text : text.slice(0, 160);
}

export function createNotesListView(options: any = {}) {
  const {
    documentRef = globalThis.document,
    notes = [],
    selectedNoteId = null,
    onExpand,
    onCopy,
  } = options;
  const root = documentRef.createElement("section");
  root.setAttribute("data-notes-list-view", "true");
  root.style.display = "grid";
  root.style.gap = "12px";

  const preview = createHoverPreview({
    documentRef,
    label: "Note preview",
    emptyText: "Hover or focus a note to preview details.",
  });
  const list = documentRef.createElement("div");
  list.style.display = "grid";
  list.style.gap = "10px";

  function render(nextNotes = notes, expandedId = selectedNoteId) {
    list.innerHTML = "";
    if (!nextNotes.length) {
      list.appendChild(createEmptyStateCard({
        documentRef,
        title: "No recent notes",
        body: "Saved notes will appear here when backend data is available.",
      }).root);
      preview.clear();
      return;
    }

    for (const note of nextNotes) {
      const expanded = note.id === expandedId;
      const row = documentRef.createElement("section");
      row.setAttribute("data-note-id", note.id || "");
      row.style.display = "grid";
      row.style.gap = "8px";
      row.style.padding = "12px";
      row.style.borderRadius = "16px";
      row.style.border = expanded ? "1px solid #0f766e" : "1px solid rgba(148, 163, 184, 0.18)";
      row.style.background = note.highlight_text ? "#f0fdfa" : "#ffffff";

      const title = documentRef.createElement("div");
      title.textContent = note.title || "Untitled note";
      title.style.fontWeight = "700";
      title.style.color = "#0f172a";

      const kind = documentRef.createElement("div");
      kind.textContent = note.highlight_text ? "Highlight note" : "Plain note";
      kind.style.fontSize = "12px";
      kind.style.color = note.highlight_text ? "#0f766e" : "#64748b";

      const body = documentRef.createElement("div");
      const detailText = getNoteSummary(note, expanded);
      body.textContent = detailText;
      body.style.whiteSpace = "pre-wrap";
      body.style.wordBreak = "break-word";
      body.style.overflowWrap = "anywhere";
      body.style.color = "#334155";

      const actions = documentRef.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";

      const expand = documentRef.createElement("button");
      expand.type = "button";
      expand.textContent = expanded ? "Collapse" : "Expand";
      expand.addEventListener("click", (event) => {
        event.preventDefault?.();
        onExpand?.(note);
      });

      const copy = documentRef.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.addEventListener("click", (event) => {
        event.preventDefault?.();
        onCopy?.({ note, text: getNoteSummary(note, true) });
      });

      for (const button of [expand, copy]) {
        button.style.padding = "7px 10px";
        button.style.borderRadius = "999px";
        button.style.border = "1px solid rgba(148, 163, 184, 0.22)";
        button.style.background = "#f8fafc";
        button.style.color = "#0f172a";
      }

      const updatePreview = () => {
        preview.render({
          label: "Note preview",
          meta: [note.title || "Untitled note", note.highlight_text ? "highlight note" : "plain note"].join(" • "),
          body: getNoteSummary(note, true),
        });
      };

      row.addEventListener("mouseenter", updatePreview);
      row.addEventListener("focusin", updatePreview);
      row.appendChild(title);
      row.appendChild(kind);
      row.appendChild(body);
      actions.appendChild(expand);
      actions.appendChild(copy);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  render(notes, selectedNoteId);
  root.appendChild(preview.root);
  root.appendChild(list);
  return { root, render };
}
