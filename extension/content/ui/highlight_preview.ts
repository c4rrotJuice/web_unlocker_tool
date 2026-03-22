function truncatePreview(value: any, maxLength = 220) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

export function createHighlightPreview({
  documentRef = globalThis.document,
}: {
  documentRef?: Document;
} = {}) {
  const root = documentRef.createElement("section");
  const label = documentRef.createElement("p");
  const text = documentRef.createElement("blockquote");
  const meta = documentRef.createElement("p");

  root.setAttribute("data-highlight-preview", "true");
  root.style.display = "grid";
  root.style.gap = "6px";

  label.textContent = "Highlight";
  label.style.margin = "0";
  label.style.fontSize = "11px";
  label.style.textTransform = "uppercase";
  label.style.letterSpacing = "0.08em";
  label.style.color = "#94a3b8";

  text.style.margin = "0";
  text.style.padding = "10px 12px";
  text.style.borderRadius = "12px";
  text.style.background = "rgba(15, 23, 42, 0.7)";
  text.style.border = "1px solid rgba(148, 163, 184, 0.22)";
  text.style.color = "#e2e8f0";
  text.style.fontSize = "12px";
  text.style.lineHeight = "1.45";

  meta.style.margin = "0";
  meta.style.fontSize = "11px";
  meta.style.lineHeight = "1.4";
  meta.style.color = "#94a3b8";

  if (typeof root.append === "function") {
    root.append(label, text, meta);
  } else {
    root.appendChild(label);
    root.appendChild(text);
    root.appendChild(meta);
  }

  return {
    root,
    render({ text: previewText = "", pageTitle = "", pageUrl = "" } = {}) {
      text.textContent = truncatePreview(previewText) || "No highlight";
      meta.textContent = [pageTitle, pageUrl].filter(Boolean).join(" • ");
    },
  };
}
