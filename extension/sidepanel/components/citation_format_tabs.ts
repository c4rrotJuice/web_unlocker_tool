import { CITATION_FORMATS } from "../../shared/types/citation.ts";

const FORMAT_LABELS = {
  inline: "Inline",
  footnote: "Footnote",
  bibliography: "Bibliography",
  quote_attribution: "Quote Attribution",
};

export function createCitationFormatTabs({
  documentRef = globalThis.document,
  formats = CITATION_FORMATS,
  selectedFormat = "bibliography",
  onSelect,
}: any = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-citation-format-tabs", "true");
  root.style.display = "flex";
  root.style.flexWrap = "wrap";
  root.style.gap = "8px";

  function render(nextSelectedFormat = selectedFormat) {
    root.innerHTML = "";
    formats.forEach((format) => {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.textContent = FORMAT_LABELS[format] || String(format || "").toUpperCase();
      button.setAttribute("data-format", format);
      button.setAttribute("aria-pressed", String(format === nextSelectedFormat));
      button.style.padding = "8px 10px";
      button.style.borderRadius = "999px";
      button.style.border = "1px solid rgba(148, 163, 184, 0.28)";
      button.style.background = format === nextSelectedFormat ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.72)";
      button.style.color = "#e2e8f0";
      button.style.cursor = "pointer";
      button.addEventListener("click", (event: any) => {
        event.preventDefault?.();
        onSelect?.(format);
      });
      root.appendChild(button);
    });
  }

  render(selectedFormat);

  return {
    root,
    render,
  };
}
