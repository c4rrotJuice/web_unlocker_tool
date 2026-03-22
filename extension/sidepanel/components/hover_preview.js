function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function truncate(value, maxLength = 220) {
    const text = normalizeText(value);
    if (!text || text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}
export function createHoverPreview({ documentRef = globalThis.document, label = "Preview", emptyText = "Hover a recent item to preview details.", } = {}) {
    const root = documentRef.createElement("section");
    root.setAttribute("data-hover-preview", "true");
    root.style.display = "grid";
    root.style.gap = "8px";
    root.style.padding = "12px 14px";
    root.style.borderRadius = "18px";
    root.style.border = "1px solid rgba(148, 163, 184, 0.18)";
    root.style.background = "#f8fafc";
    const heading = documentRef.createElement("div");
    heading.style.fontSize = "12px";
    heading.style.letterSpacing = "0.08em";
    heading.style.textTransform = "uppercase";
    heading.style.color = "#64748b";
    const meta = documentRef.createElement("div");
    meta.style.fontSize = "12px";
    meta.style.color = "#0f766e";
    const body = documentRef.createElement("div");
    body.style.whiteSpace = "pre-wrap";
    body.style.wordBreak = "break-word";
    body.style.overflowWrap = "anywhere";
    body.style.color = "#334155";
    body.style.lineHeight = "1.5";
    function render(next = {}) {
        heading.textContent = next.label || label;
        meta.textContent = next.meta ? truncate(next.meta, 140) : "";
        body.textContent = truncate(next.body || emptyText, 340) || emptyText;
    }
    function clear() {
        render({ label, meta: "", body: emptyText });
    }
    root.appendChild(heading);
    root.appendChild(meta);
    root.appendChild(body);
    clear();
    return { root, render, clear };
}
