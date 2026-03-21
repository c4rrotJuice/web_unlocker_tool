import { CITATION_STYLES } from "../../shared/types/citation.ts";

const STYLE_LABELS = {
  apa: "APA",
  mla: "MLA",
  chicago: "Chicago",
  harvard: "Harvard",
};

export function createCitationStyleTabs({
  documentRef = globalThis.document,
  styles = CITATION_STYLES,
  selectedStyle = "apa",
  lockedStyles = [],
  onSelect,
} = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-citation-style-tabs", "true");
  root.style.display = "flex";
  root.style.gap = "8px";
  root.style.flexWrap = "wrap";

  styles.forEach((style) => {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = STYLE_LABELS[style] || style.toUpperCase();
    button.setAttribute("data-style", style);
    button.setAttribute("aria-pressed", String(style === selectedStyle));
    button.style.padding = "8px 10px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid rgba(148, 163, 184, 0.32)";
    button.style.background = style === selectedStyle ? "rgba(59, 130, 246, 0.18)" : "rgba(15, 23, 42, 0.7)";
    button.style.color = "#e2e8f0";
    button.style.cursor = "pointer";
    button.disabled = false;
    const isLocked = lockedStyles.includes(style);
    if (isLocked) {
      button.setAttribute("data-locked", "true");
      button.setAttribute("aria-disabled", "true");
      button.disabled = true;
      button.style.opacity = "0.55";
      button.style.cursor = "not-allowed";
      button.title = `${button.textContent} locked by backend`;
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (isLocked) {
        return;
      }
      onSelect?.(style);
    });
    root.appendChild(button);
  });

  return {
    root,
    setSelected(nextStyle) {
      for (const button of root.children || []) {
        const style = button.getAttribute?.("data-style");
        button.setAttribute?.("aria-pressed", String(style === nextStyle));
        button.style.background = style === nextStyle ? "rgba(59, 130, 246, 0.18)" : "rgba(15, 23, 42, 0.7)";
      }
    },
  };
}
