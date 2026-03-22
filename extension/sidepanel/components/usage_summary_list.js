// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
export function createUsageSummaryList({ documentRef = globalThis.document, } = {}) {
    const root = documentRef.createElement("section");
    root.setAttribute("data-usage-summary-list", "true");
    root.style.display = "grid";
    root.style.gap = "8px";
    root.style.padding = "14px 16px";
    root.style.borderRadius = "18px";
    root.style.background = "#ffffff";
    root.style.border = "1px solid rgba(148, 163, 184, 0.18)";
    const title = documentRef.createElement("div");
    title.textContent = "Usage";
    title.style.fontSize = "12px";
    title.style.letterSpacing = "0.08em";
    title.style.textTransform = "uppercase";
    title.style.color = "#64748b";
    const list = documentRef.createElement("div");
    list.style.display = "grid";
    list.style.gap = "6px";
    function render(items = []) {
        list.innerHTML = "";
        const visibleItems = Array.isArray(items)
            ? items.filter((item) => String(item?.label || "").trim() && String(item?.value || "").trim())
            : [];
        if (!visibleItems.length) {
            const empty = documentRef.createElement("div");
            empty.textContent = "Usage updates appear here when available.";
            empty.style.color = "#64748b";
            empty.style.fontSize = "13px";
            list.appendChild(empty);
            return;
        }
        for (const item of visibleItems) {
            const row = documentRef.createElement("div");
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            row.style.alignItems = "baseline";
            row.style.gap = "12px";
            row.style.fontSize = "13px";
            const label = documentRef.createElement("span");
            label.textContent = item.label;
            label.style.color = "#475569";
            label.style.flex = "1";
            const value = documentRef.createElement("span");
            value.textContent = item.value;
            value.style.color = "#0f172a";
            value.style.fontWeight = "600";
            value.style.textAlign = "right";
            value.style.maxWidth = "50%";
            value.style.overflowWrap = "anywhere";
            row.appendChild(label);
            row.appendChild(value);
            list.appendChild(row);
        }
    }
    root.appendChild(title);
    root.appendChild(list);
    return { root, render };
}
