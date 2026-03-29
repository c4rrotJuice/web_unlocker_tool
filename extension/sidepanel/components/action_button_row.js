// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { shouldPresentSignedInUi } from "../../shared/types/auth.js";
function createButton(documentRef, label, tone = "default") {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.minHeight = "36px";
    button.style.padding = "0 12px";
    button.style.borderRadius = "10px";
    button.style.border = tone === "primary"
        ? "1px solid rgba(248, 250, 252, 0.3)"
        : "1px solid rgba(148, 163, 184, 0.18)";
    button.style.background = tone === "primary" ? "#e2e8f0" : "rgba(15, 23, 42, 0.66)";
    button.style.color = tone === "primary" ? "#0f172a" : "#e2e8f0";
    button.style.fontSize = "12px";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    return button;
}
export function createActionButtonRow({ documentRef = globalThis.document, onOpenEditor, onOpenDashboard, onSignIn, onSignOut, } = {}) {
    const root = documentRef.createElement("div");
    root.setAttribute("data-action-row", "true");
    root.style.display = "grid";
    root.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    root.style.gap = "8px";
    const openEditorButton = createButton(documentRef, "Open Editor", "primary");
    const dashboardButton = createButton(documentRef, "Dashboard");
    const authButton = createButton(documentRef, "Sign In");
    openEditorButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        void onOpenEditor?.();
    });
    dashboardButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        void onOpenDashboard?.();
    });
    authButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        const signedIn = authButton.getAttribute("data-auth-state") === "signed_in";
        void (signedIn ? onSignOut?.() : onSignIn?.());
    });
    root.append(openEditorButton, dashboardButton, authButton);
    function render(auth = null) {
        const signedIn = shouldPresentSignedInUi(auth);
        openEditorButton.disabled = !signedIn;
        dashboardButton.disabled = !signedIn;
        authButton.textContent = signedIn ? "Sign Out" : "Sign In";
        authButton.setAttribute("data-auth-state", signedIn ? "signed_in" : "signed_out");
    }
    return { root, render };
}
