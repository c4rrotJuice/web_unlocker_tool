// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
export function createSidepanelTabs(options = {}) {
    const { documentRef = globalThis.document, tabs = [], activeTab = "", onSelect, } = options;
    const root = documentRef.createElement("div");
    root.setAttribute("data-sidepanel-tabs", "true");
    root.style.display = "grid";
    root.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    root.style.gap = "8px";
    function render(nextTabs = tabs, nextActiveTab = activeTab) {
        root.innerHTML = "";
        for (const tab of nextTabs) {
            const button = documentRef.createElement("button");
            button.type = "button";
            button.textContent = tab.label;
            button.setAttribute("data-tab", tab.key);
            button.setAttribute("aria-pressed", String(tab.key === nextActiveTab));
            button.style.padding = "10px 12px";
            button.style.borderRadius = "14px";
            button.style.border = "1px solid rgba(148, 163, 184, 0.22)";
            button.style.background = tab.key === nextActiveTab ? "#0f172a" : "#ffffff";
            button.style.color = tab.key === nextActiveTab ? "#f8fafc" : "#0f172a";
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
