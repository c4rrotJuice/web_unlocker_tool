export function bindToolbarController({ toolbar, focusTarget, onInsertCitation }) {
  const requestFocus = () => {
    if (!focusTarget) return;
    const raf = globalThis.window?.requestAnimationFrame;
    if (typeof raf === "function") {
      raf(() => {
        focusTarget.focus?.();
      });
      return;
    }
    focusTarget.focus?.();
  };

  const onClick = (event) => {
    const actionButton = event.target.closest("[data-toolbar-action]");
    if (!actionButton) return;
    if (actionButton.dataset.toolbarAction === "insert-citation") {
      onInsertCitation?.();
      requestFocus();
    }
  };

  toolbar.addEventListener("click", onClick);

  return {
    dispose() {
      toolbar.removeEventListener("click", onClick);
    },
  };
}
