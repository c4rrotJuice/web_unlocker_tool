function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength = 220) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function createHoverPreview({
  documentRef = globalThis.document,
  label = "Preview",
  emptyText = "Hover a recent item to preview details.",
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-hover-preview", "true");
  root.style.display = "grid";
  root.style.gap = "8px";
  root.style.padding = "14px 16px";
  root.style.borderRadius = "18px";
  root.style.border = "1px solid rgba(148, 163, 184, 0.16)";
  root.style.background = "rgba(15, 23, 42, 0.72)";
  root.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.04)";

  const heading = documentRef.createElement("div");
  heading.textContent = label;
  heading.style.fontSize = "12px";
  heading.style.textTransform = "uppercase";
  heading.style.letterSpacing = "0.08em";
  heading.style.color = "#94a3b8";

  const meta = documentRef.createElement("div");
  meta.style.fontSize = "12px";
  meta.style.color = "#7dd3fc";
  meta.style.letterSpacing = "0.02em";

  const body = documentRef.createElement("div");
  body.style.color = "#e2e8f0";
  body.style.lineHeight = "1.55";
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  body.style.overflowWrap = "anywhere";
  body.textContent = emptyText;

  function render(next = {}) {
    heading.textContent = next.label || label;
    meta.textContent = next.meta ? truncate(next.meta, 140) : "";
    body.textContent = truncate(next.body || emptyText, 340) || emptyText;
  }

  function clear() {
    render({ label, body: emptyText, meta: "" });
  }

  clear();
  root.appendChild(heading);
  root.appendChild(meta);
  root.appendChild(body);

  return {
    root,
    render,
    clear,
  };
}
