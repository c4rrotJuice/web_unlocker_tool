export function bindContextTabs({ buttons, panes = [], onChange = null }) {
  let currentTab = "citations";

  function setActive(nextTab) {
    currentTab = nextTab;
    for (const button of buttons) {
      const selected = button.dataset.contextTab === nextTab;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    for (const pane of panes) {
      pane.hidden = pane.dataset.contextPane !== nextTab;
    }
    onChange?.(nextTab);
  }

  const listeners = buttons.map((button) => {
    const handler = () => setActive(button.dataset.contextTab || "citations");
    button.addEventListener("click", handler);
    return () => button.removeEventListener("click", handler);
  });

  setActive(currentTab);

  return {
    getActive() {
      return currentTab;
    },
    setActive,
    dispose() {
      while (listeners.length) listeners.pop()();
    },
  };
}
