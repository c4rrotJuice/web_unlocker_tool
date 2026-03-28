export function createSidepanelTabs(options: any = {}) {
  const {
    documentRef = globalThis.document,
    tabs = [],
    activeTab = "",
    onSelect,
  } = options;
  const root = documentRef.createElement("div");
  root.setAttribute("data-sidepanel-tabs", "true");
  root.style.display = "grid";
  root.style.gridTemplateColumns = "repeat(5, minmax(0, 1fr))";
  root.style.gap = "6px";

  function render(nextTabs = tabs, nextActiveTab = activeTab) {
    root.innerHTML = "";
    for (const tab of nextTabs) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.textContent = tab.label;
      button.setAttribute("data-tab", tab.key);
      button.setAttribute("aria-pressed", String(tab.key === nextActiveTab));
      button.style.minHeight = "34px";
      button.style.padding = "0 6px";
      button.style.borderRadius = "10px";
      button.style.border = tab.key === nextActiveTab
        ? "1px solid rgba(226, 232, 240, 0.3)"
        : "1px solid rgba(148, 163, 184, 0.12)";
      button.style.background = tab.key === nextActiveTab ? "#e2e8f0" : "rgba(15, 23, 42, 0.5)";
      button.style.color = tab.key === nextActiveTab ? "#0f172a" : "#cbd5e1";
      button.style.fontSize = "11px";
      button.style.fontWeight = tab.key === nextActiveTab ? "700" : "600";
      button.addEventListener("click", (event) => {
        event.preventDefault?.();
        onSelect?.(tab.key);
      });
      root.appendChild(button);
    }
  }

  render();
  return { root, render };
}
