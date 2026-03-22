import { getCitationPreviewText, normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.ts";
import { createHoverPreview } from "./hover_preview.ts";

export function createCitationsListView({
  documentRef = globalThis.document,
  citations = [],
  selectedCitationId = null,
  lockedStyles = [],
  actionAvailability = {},
  onExpand,
  onCopy,
  onSave,
  onWorkInEditor,
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-citations-list-view", "true");
  root.style.display = "grid";
  root.style.gap = "12px";
  root.style.position = "relative";

  const header = documentRef.createElement("div");
  header.textContent = "Citations";
  header.style.fontSize = "13px";
  header.style.textTransform = "uppercase";
  header.style.letterSpacing = "0.08em";
  header.style.color = "#94a3b8";

  const list = documentRef.createElement("div");
  list.style.display = "grid";
  list.style.gap = "10px";
  const hoverPreview = createHoverPreview({
    documentRef,
    label: "Citation preview",
    emptyText: "Hover or focus a citation to preview its canonical text.",
  });

  function render(nextCitations = citations, nextSelectedCitationId = selectedCitationId) {
    list.innerHTML = "";
    if (!nextCitations.length) {
      const empty = documentRef.createElement("div");
      empty.textContent = "No recent citations yet.";
      empty.style.color = "#94a3b8";
      list.appendChild(empty);
      return;
    }
    for (const citation of nextCitations) {
      const row = documentRef.createElement("section");
      row.setAttribute("data-citation-id", citation.id || "");
      row.setAttribute("tabindex", "0");
      row.setAttribute("role", "button");
      row.style.display = "grid";
      row.style.gap = "8px";
      row.style.padding = "12px";
      row.style.borderRadius = "16px";
      row.style.border = citation.id === nextSelectedCitationId ? "1px solid rgba(59, 130, 246, 0.5)" : "1px solid rgba(148, 163, 184, 0.16)";
      row.style.background = "rgba(15, 23, 42, 0.72)";
      row.style.cursor = "default";

      const title = documentRef.createElement("div");
      title.textContent = citation.source?.title || citation.excerpt || "Citation";
      title.style.fontSize = "14px";
      title.style.fontWeight = "700";
      title.style.color = "#f8fafc";
      title.style.overflowWrap = "anywhere";
      row.setAttribute("aria-label", `${title.textContent || "Citation"} actions`);

      const meta = documentRef.createElement("div");
      meta.style.fontSize = "12px";
      meta.style.color = "#94a3b8";
      meta.textContent = [citation.source?.hostname, citation.created_at].filter(Boolean).join(" • ");

      const preview = documentRef.createElement("div");
      preview.style.whiteSpace = "pre-wrap";
      preview.style.wordBreak = "break-word";
      preview.style.overflowWrap = "anywhere";
      preview.style.color = "#cbd5e1";
      const style = normalizeCitationStyle(citation.style || "apa");
      const format = normalizeCitationFormat(citation.format || "bibliography");
      preview.textContent = getCitationPreviewText(citation, style, format) || citation.excerpt || "No preview available.";

      const actions = documentRef.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.flexWrap = "wrap";

      const expand = documentRef.createElement("button");
      expand.type = "button";
      expand.textContent = citation.id === nextSelectedCitationId ? "Collapse" : "Expand";
      expand.style.padding = "7px 10px";
      expand.style.borderRadius = "999px";
      expand.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      expand.style.background = "rgba(15, 23, 42, 0.72)";
      expand.style.color = "#f8fafc";
      expand.addEventListener("click", (event) => {
        event.preventDefault();
        onExpand?.(citation);
      });

      const copy = documentRef.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.style.padding = "7px 10px";
      copy.style.borderRadius = "999px";
      copy.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      copy.style.background = "rgba(59, 130, 246, 0.18)";
      copy.style.color = "#f8fafc";
      copy.addEventListener("click", (event) => {
        event.preventDefault();
        onCopy?.({ citation, text: preview.textContent || "" });
      });

      const save = documentRef.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.style.padding = "7px 10px";
      save.style.borderRadius = "999px";
      save.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      save.style.background = "rgba(15, 23, 42, 0.72)";
      save.style.color = "#f8fafc";
      save.addEventListener("click", (event) => {
        event.preventDefault();
        onSave?.({ citation, text: preview.textContent || "" });
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
          onWorkInEditor?.({ citation, text: preview.textContent || "" });
        }
      });

      const updatePreview = () => {
        hoverPreview.render({
          label: "Citation preview",
          meta: [citation.source?.title || title.textContent || "Citation", citation.source?.hostname, citation.style, citation.format].filter(Boolean).join(" • "),
          body: preview.textContent || citation.excerpt || "No preview available.",
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
          onExpand?.(citation);
        }
      });

      if (Array.isArray(lockedStyles) && lockedStyles.length) {
        const locked = documentRef.createElement("div");
        locked.textContent = `Locked styles: ${lockedStyles.join(", ")}`;
        locked.style.color = "#fca5a5";
        locked.style.fontSize = "12px";
        row.appendChild(locked);
      }

      actions.appendChild(expand);
      actions.appendChild(copy);
      actions.appendChild(save);
      actions.appendChild(workInEditor);
      row.appendChild(title);
      row.appendChild(meta);
      row.appendChild(preview);
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
