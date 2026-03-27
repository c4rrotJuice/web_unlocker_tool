export function bindToolbarController({ toolbar, onInsertCitation }) {
  const advancedGroups = Array.from(toolbar.querySelectorAll('[data-toolbar-group="advanced"]'));
  const toggleButton = toolbar.querySelector('[data-toolbar-action="toggle-expand"]');
  const citationButton = toolbar.querySelector('[data-toolbar-action="insert-citation"]');
  let expanded = false;

  function render() {
    toolbar.dataset.toolbarExpanded = expanded ? "true" : "false";
    if (toggleButton) {
      toggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggleButton.textContent = expanded ? "Less" : "More";
    }
    for (const group of advancedGroups) {
      group.hidden = !expanded;
    }
  }

  const onClick = (event) => {
    const actionButton = event.target.closest("[data-toolbar-action]");
    if (!actionButton) return;
    if (actionButton.dataset.toolbarAction === "toggle-expand") {
      expanded = !expanded;
      render();
      return;
    }
    if (actionButton.dataset.toolbarAction === "insert-citation") {
      onInsertCitation?.();
    }
  };

  toolbar.addEventListener("click", onClick);
  render();

  return {
    setExpanded(nextExpanded) {
      expanded = !!nextExpanded;
      render();
    },
    dispose() {
      toolbar.removeEventListener("click", onClick);
    },
  };
}
