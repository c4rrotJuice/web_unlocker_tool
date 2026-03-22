export function createUsageSummaryList({
  documentRef = globalThis.document,
  items = [],
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-usage-summary-list", "true");
  root.style.display = "grid";
  root.style.gap = "8px";
  root.style.padding = "14px 16px";
  root.style.borderRadius = "18px";
  root.style.background = "rgba(15, 23, 42, 0.7)";
  root.style.border = "1px solid rgba(148, 163, 184, 0.16)";

  const title = documentRef.createElement("div");
  title.textContent = "Usage";
  title.style.fontSize = "12px";
  title.style.textTransform = "uppercase";
  title.style.letterSpacing = "0.08em";
  title.style.color = "#94a3b8";

  const list = documentRef.createElement("div");
  list.style.display = "grid";
  list.style.gap = "8px";

  function render(nextItems = items) {
    list.innerHTML = "";
    for (const item of nextItems) {
      const row = documentRef.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "12px";
      row.style.fontSize = "13px";
      const label = documentRef.createElement("span");
      label.textContent = item.label;
      label.style.color = "#cbd5e1";
      const value = documentRef.createElement("span");
      value.textContent = item.value;
      value.style.color = "#f8fafc";
      value.style.fontWeight = "600";
      row.appendChild(label);
      row.appendChild(value);
      list.appendChild(row);
    }
    if (!nextItems.length) {
      const empty = documentRef.createElement("div");
      empty.textContent = "No usage data available.";
      empty.style.color = "#94a3b8";
      list.appendChild(empty);
    }
  }

  render();
  root.appendChild(title);
  root.appendChild(list);

  return {
    root,
    render,
  };
}
