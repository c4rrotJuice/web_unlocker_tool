export function createSidepanelTabs({
  documentRef = globalThis.document,
  tabs = [],
  activeTab = "",
  onSelect,
} = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-sidepanel-tabs", "true");
  root.style.display = "flex";
  root.style.gap = "8px";
  root.style.flexWrap = "wrap";

  function renderButtons(nextTabs = tabs, nextActiveTab = activeTab) {
    root.innerHTML = "";
    for (const tab of nextTabs) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.textContent = tab.label;
      button.setAttribute("data-tab", tab.key);
      button.setAttribute("aria-pressed", String(tab.key === nextActiveTab));
      button.style.padding = "8px 12px";
      button.style.borderRadius = "999px";
      button.style.border = "1px solid rgba(148, 163, 184, 0.24)";
      button.style.background = tab.key === nextActiveTab ? "rgba(59, 130, 246, 0.18)" : "rgba(15, 23, 42, 0.72)";
      button.style.color = "#e2e8f0";
      button.style.cursor = "pointer";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        onSelect?.(tab.key);
      });
      root.appendChild(button);
    }
  }

  renderButtons();

  return {
    root,
    render: renderButtons,
  };
}
