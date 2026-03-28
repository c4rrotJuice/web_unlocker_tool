function normalizeText(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function createUsageGaugeItem({ documentRef = globalThis.document } = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-usage-gauge", "true");
  root.style.display = "grid";
  root.style.gap = "4px";
  root.style.padding = "10px 8px";
  root.style.border = "1px solid rgba(148, 163, 184, 0.14)";
  root.style.borderRadius = "12px";
  root.style.background = "rgba(15, 23, 42, 0.72)";
  root.style.textAlign = "center";
  root.style.minWidth = "0";

  const value = documentRef.createElement("div");
  value.style.fontSize = "16px";
  value.style.lineHeight = "1";
  value.style.fontWeight = "700";
  value.style.color = "#f8fafc";

  const label = documentRef.createElement("div");
  label.style.fontSize = "11px";
  label.style.lineHeight = "1.2";
  label.style.textTransform = "lowercase";
  label.style.color = "#94a3b8";

  root.append(value, label);

  function render(item: any = null) {
    const itemValue = normalizeText(item?.value);
    const itemLabel = normalizeText(item?.label);
    value.textContent = itemValue;
    label.textContent = itemLabel;
    root.style.display = itemValue && itemLabel ? "grid" : "none";
  }

  return { root, render };
}

export function createUsageGaugeRow({ documentRef = globalThis.document } = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-usage-gauge-row", "true");
  root.style.display = "grid";
  root.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
  root.style.gap = "8px";

  const items = [0, 1, 2, 3].map(() => createUsageGaugeItem({ documentRef }));
  root.append(...items.map((entry) => entry.root));

  function render(nextItems: any[] = []) {
    const visible = Array.isArray(nextItems)
      ? nextItems.filter((item) => normalizeText(item?.label) && normalizeText(item?.value)).slice(0, 4)
      : [];
    items.forEach((entry, index) => entry.render(visible[index] || null));
    root.style.display = visible.length ? "grid" : "none";
  }

  return { root, render };
}
