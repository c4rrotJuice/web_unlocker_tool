export function bindKeyboardShortcuts({ root, selectionState, commandRegistry, handlers }) {
  function onCompositionStart() {
    selectionState.setComposing(true);
  }

  function onCompositionEnd() {
    selectionState.setComposing(false);
  }

  function onKeydown(event) {
    const selection = selectionState.getState();
    if (selection.composing || event.isComposing) {
      return;
    }
    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key.toLowerCase() === "k") {
      event.preventDefault();
      handlers.openCommandMenu("");
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      handlers.focusExplorerSearch();
      return;
    }
    if (meta && event.key === "Enter") {
      event.preventDefault();
      commandRegistry.invoke("create_checkpoint");
      return;
    }
    if (!meta && !event.altKey && !event.shiftKey && (event.key === "@" || event.key === "/")) {
      const target = event.target;
      if (root.contains(target)) {
        event.preventDefault();
        handlers.openCommandMenu(event.key === "@" ? "insert" : "");
      }
    }
  }

  root.addEventListener("compositionstart", onCompositionStart);
  root.addEventListener("compositionend", onCompositionEnd);
  document.addEventListener("keydown", onKeydown);

  return () => {
    root.removeEventListener("compositionstart", onCompositionStart);
    root.removeEventListener("compositionend", onCompositionEnd);
    document.removeEventListener("keydown", onKeydown);
  };
}
