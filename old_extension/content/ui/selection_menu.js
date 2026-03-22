export const SELECTION_MENU_ACTIONS = Object.freeze([
  { key: "copy", label: "Copy", active: true, locked: false },
  { key: "work_in_editor", label: "Editor", active: true, locked: false },
  { key: "cite", label: "Cite", active: true, locked: false },
  { key: "note", label: "Note", active: true, locked: false },
  { key: "quote", label: "Quote", active: true, locked: false },
]);

function createButton(documentRef, action, onAction) {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.textContent = action.label;
  button.setAttribute("data-selection-action", action.key);
  button.setAttribute("aria-label", action.label);
  button.setAttribute(
    "aria-keyshortcuts",
    action.key === "copy"
      ? "Ctrl+Shift+C"
      : action.key === "work_in_editor"
        ? "Ctrl+Shift+E"
        : action.key === "cite"
          ? "Ctrl+Shift+I"
          : action.key === "note"
            ? "Ctrl+Shift+N"
            : "Ctrl+Shift+Q",
  );
  if (action.locked) {
    button.title = `${action.label} locked by backend`;
  } else {
    button.title = action.key === "copy"
      ? "Copy selection"
      : action.key === "work_in_editor"
        ? "Open in editor"
        : action.key === "cite"
          ? "Create citation"
          : action.key === "note"
            ? "Create note"
            : "Create quote";
  }
  if (action.locked) {
    button.setAttribute("data-locked", "true");
    button.setAttribute("aria-disabled", "true");
    button.disabled = true;
  } else if (!action.active) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  }
  button.style.opacity = action.locked || !action.active ? "0.52" : "1";
  button.style.cursor = action.locked || !action.active ? "not-allowed" : "pointer";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (action.active && !action.locked) {
      onAction?.(action.key);
    }
  });
  return button;
}

export function createSelectionMenu({ documentRef = globalThis.document, onAction, actions = SELECTION_MENU_ACTIONS } = {}) {
  const root = documentRef.createElement("div");
  root.setAttribute("data-selection-menu", "true");
  root.style.display = "flex";
  root.style.gap = "6px";
  root.style.alignItems = "center";
  root.style.pointerEvents = "auto";
  const buttons = [];

  function render(nextActions = actions) {
    root.innerHTML = "";
    buttons.length = 0;
    nextActions.forEach((action) => {
      const button = createButton(documentRef, action, onAction);
      buttons.push(button);
      if (action.active || action.locked) {
        root.appendChild(button);
      }
    });
    return root;
  }

  render(actions);

  return {
    root,
    buttons,
    render,
    setStatus(status) {
      for (const button of buttons) {
        if (button.getAttribute("data-selection-action") === "copy") {
          button.textContent = status || "Copy";
        }
      }
    },
    setActions(nextActions = actions) {
      render(nextActions);
    },
  };
}
