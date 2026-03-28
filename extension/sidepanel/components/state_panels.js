// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
function createPanel(documentRef, tone = "neutral") {
    const root = documentRef.createElement("section");
    root.style.display = "grid";
    root.style.gap = "6px";
    root.style.padding = "14px";
    root.style.borderRadius = "12px";
    root.style.border = tone === "error"
        ? "1px solid rgba(248, 113, 113, 0.26)"
        : "1px solid rgba(148, 163, 184, 0.14)";
    root.style.background = tone === "error" ? "rgba(69, 10, 10, 0.32)" : "rgba(15, 23, 42, 0.5)";
    return root;
}
function buildState(documentRef, titleText, bodyText, tone = "neutral", attr = "state") {
    const root = createPanel(documentRef, tone);
    root.setAttribute(`data-${attr}`, "true");
    const title = documentRef.createElement("div");
    title.textContent = titleText;
    title.style.fontSize = "13px";
    title.style.fontWeight = "700";
    title.style.color = "#f8fafc";
    const body = documentRef.createElement("div");
    body.textContent = bodyText;
    body.style.fontSize = "12px";
    body.style.lineHeight = "1.45";
    body.style.color = "#94a3b8";
    root.append(title, body);
    return root;
}
export function createEmptyState({ documentRef = globalThis.document, title = "", body = "" } = {}) {
    return buildState(documentRef, title, body, "neutral", "empty-state");
}
export function createGatedState({ documentRef = globalThis.document, title = "", body = "" } = {}) {
    return buildState(documentRef, title, body, "neutral", "gated-state");
}
export function createErrorState({ documentRef = globalThis.document, title = "", body = "" } = {}) {
    return buildState(documentRef, title, body, "error", "error-state");
}
