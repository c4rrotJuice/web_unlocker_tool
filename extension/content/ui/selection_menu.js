// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createSelectionMenuButton } from "./selection_menu_button.js";
export const SELECTION_MENU_ACTIONS = Object.freeze([
    { key: "copy", label: "Copy", active: true, locked: false },
    { key: "cite", label: "Cite", active: true, locked: false },
    { key: "note", label: "Note", active: true, locked: false },
    { key: "quote", label: "Quote", active: true, locked: false },
]);
export function createSelectionMenu({ documentRef = globalThis.document, onAction, actions = SELECTION_MENU_ACTIONS, } = {}) {
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
            if (action?.active === false && action?.locked !== true) {
                return;
            }
            const button = createSelectionMenuButton({ documentRef, action, onAction });
            buttons.push(button);
            root.appendChild(button);
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
