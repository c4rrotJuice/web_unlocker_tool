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
  lockLabel = "Locked",
  onSelect,
}: any = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-citation-style-tabs", "true");
  root.style.display = "flex";
  root.style.flexWrap = "wrap";
  root.style.gap = "8px";

  function render(nextSelectedStyle = selectedStyle) {
    root.innerHTML = "";
    styles.forEach((style) => {
      const button = documentRef.createElement("button");
      const locked = Array.isArray(lockedStyles) && lockedStyles.includes(style);
      button.type = "button";
      button.textContent = locked
        ? `${STYLE_LABELS[style] || String(style || "").toUpperCase()} ${lockLabel}`
        : STYLE_LABELS[style] || String(style || "").toUpperCase();
      button.setAttribute("data-style", style);
      button.setAttribute("aria-pressed", String(style === nextSelectedStyle));
      button.style.padding = "8px 10px";
      button.style.borderRadius = "999px";
      button.style.border = locked
        ? "1px dashed rgba(248, 250, 252, 0.28)"
        : "1px solid rgba(148, 163, 184, 0.28)";
      button.style.background = style === nextSelectedStyle ? "rgba(14, 165, 233, 0.18)" : "rgba(15, 23, 42, 0.72)";
      button.style.color = "#e2e8f0";
      button.style.opacity = locked ? "0.68" : "1";
      button.style.cursor = locked ? "not-allowed" : "pointer";
      button.disabled = locked;
      if (locked) {
        button.setAttribute("data-locked", "true");
        button.setAttribute("aria-disabled", "true");
        button.title = "Locked by backend plan state.";
      }
      button.addEventListener("click", (event: any) => {
        event.preventDefault?.();
        if (!locked) {
          onSelect?.(style);
        }
      });
      root.appendChild(button);
    });
  }

  render(selectedStyle);

  return {
    root,
    render,
  };
}
