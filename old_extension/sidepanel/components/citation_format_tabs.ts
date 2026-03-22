import { CITATION_FORMATS } from "../../shared/types/citation.ts";

const FORMAT_LABELS = {
  inline: "Inline",
  footnote: "Footnote",
  bibliography: "Bibliography",
};

export function createCitationFormatTabs({
  documentRef = globalThis.document,
  formats = CITATION_FORMATS,
  selectedFormat = "bibliography",
  onSelect,
} = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-citation-format-tabs", "true");
  root.style.display = "flex";
  root.style.gap = "8px";
  root.style.flexWrap = "wrap";

  formats.forEach((format) => {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = FORMAT_LABELS[format] || format.toUpperCase();
    button.setAttribute("data-format", format);
    button.setAttribute("aria-pressed", String(format === selectedFormat));
    button.style.padding = "8px 10px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid rgba(148, 163, 184, 0.32)";
    button.style.background = format === selectedFormat ? "rgba(14, 165, 233, 0.18)" : "rgba(15, 23, 42, 0.7)";
    button.style.color = "#e2e8f0";
    button.style.cursor = "pointer";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onSelect?.(format);
    });
    root.appendChild(button);
  });

  return {
    root,
    setSelected(nextFormat) {
      for (const button of root.children || []) {
        const format = button.getAttribute?.("data-format");
        button.setAttribute?.("aria-pressed", String(format === nextFormat));
        button.style.background = format === nextFormat ? "rgba(14, 165, 233, 0.18)" : "rgba(15, 23, 42, 0.7)";
      }
    },
  };
}
