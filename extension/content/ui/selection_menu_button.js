export function createSelectionMenuButton({ documentRef = globalThis.document, action, onAction, }) {
    const button = documentRef.createElement("button");
    const isDisabled = action?.active === false || action?.locked === true;
    button.type = "button";
    button.textContent = action?.label || "";
    button.setAttribute("data-selection-action", action?.key || "");
    button.setAttribute("aria-label", action?.label || "");
    button.disabled = isDisabled;
    if (isDisabled) {
        button.setAttribute("aria-disabled", "true");
    }
    button.style.appearance = "none";
    button.style.border = "1px solid rgba(148, 163, 184, 0.28)";
    button.style.background = isDisabled ? "rgba(15, 23, 42, 0.56)" : "rgba(248, 250, 252, 0.1)";
    button.style.color = "#f8fafc";
    button.style.borderRadius = "999px";
    button.style.padding = "6px 10px";
    button.style.fontSize = "12px";
    button.style.lineHeight = "1";
    button.style.fontWeight = "600";
    button.style.cursor = isDisabled ? "not-allowed" : "pointer";
    button.style.opacity = isDisabled ? "0.54" : "1";
    const preserveSelection = (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
    };
    button.addEventListener("pointerdown", preserveSelection);
    button.addEventListener("mousedown", preserveSelection);
    button.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (!isDisabled) {
            onAction?.(action?.key);
        }
    });
    return button;
}
