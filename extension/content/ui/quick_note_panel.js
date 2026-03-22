// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { computePillPosition } from "../selection/position.js";
import { createHighlightPreview } from "./highlight_preview.js";
const HOST_ID = "writior-quick-note-panel";
const HOST_ATTR = "data-writior-quick-note-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
function createContainer(documentRef) {
    const host = documentRef.createElement("div");
    host.id = HOST_ID;
    host.setAttribute(HOST_ATTR, "true");
    host.setAttribute(EXTENSION_UI_ATTR, "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.style.display = "none";
    return host;
}
function setDisabled(element, disabled) {
    element.disabled = disabled;
    if (disabled) {
        element.setAttribute("aria-disabled", "true");
    }
    else if (typeof element.removeAttribute === "function") {
        element.removeAttribute("aria-disabled");
    }
}
export function createQuickNotePanel({ documentRef = globalThis.document, windowRef = globalThis.window, onSave, onCancel, onInput, } = {}) {
    const host = createContainer(documentRef);
    const panel = documentRef.createElement("section");
    const heading = documentRef.createElement("p");
    const preview = createHighlightPreview({ documentRef });
    const textarea = documentRef.createElement("textarea");
    const feedback = documentRef.createElement("p");
    const actions = documentRef.createElement("div");
    const cancelButton = documentRef.createElement("button");
    const saveButton = documentRef.createElement("button");
    panel.setAttribute("data-quick-note-panel", "true");
    panel.setAttribute(EXTENSION_UI_ATTR, "true");
    panel.style.position = "absolute";
    panel.style.display = "none";
    panel.style.width = "min(320px, calc(100vw - 16px))";
    panel.style.padding = "12px";
    panel.style.borderRadius = "16px";
    panel.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    panel.style.background = "rgba(2, 6, 23, 0.98)";
    panel.style.boxShadow = "0 20px 44px rgba(15, 23, 42, 0.28)";
    panel.style.pointerEvents = "auto";
    panel.style.fontFamily = "Georgia, 'Times New Roman', serif";
    panel.style.display = "grid";
    panel.style.gap = "10px";
    heading.textContent = "New note";
    heading.style.margin = "0";
    heading.style.color = "#f8fafc";
    heading.style.fontSize = "14px";
    heading.style.fontWeight = "600";
    textarea.value = "";
    textarea.rows = 5;
    textarea.placeholder = "Add a note about this highlight";
    textarea.setAttribute("data-quick-note-input", "true");
    textarea.style.width = "100%";
    textarea.style.resize = "vertical";
    textarea.style.padding = "12px";
    textarea.style.borderRadius = "12px";
    textarea.style.border = "1px solid rgba(148, 163, 184, 0.22)";
    textarea.style.background = "rgba(15, 23, 42, 0.72)";
    textarea.style.color = "#f8fafc";
    textarea.style.fontFamily = "inherit";
    textarea.style.fontSize = "13px";
    textarea.style.lineHeight = "1.45";
    feedback.style.margin = "0";
    feedback.style.minHeight = "16px";
    feedback.style.fontSize = "12px";
    feedback.style.lineHeight = "1.35";
    feedback.style.color = "#94a3b8";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    for (const button of [cancelButton, saveButton]) {
        button.type = "button";
        button.style.padding = "8px 12px";
        button.style.borderRadius = "999px";
        button.style.border = "1px solid rgba(148, 163, 184, 0.24)";
        button.style.color = "#f8fafc";
        button.style.cursor = "pointer";
    }
    cancelButton.textContent = "Cancel";
    cancelButton.style.background = "rgba(15, 23, 42, 0.72)";
    saveButton.textContent = "Save note";
    saveButton.setAttribute("data-quick-note-save", "true");
    saveButton.style.background = "rgba(14, 165, 233, 0.2)";
    if (typeof actions.append === "function") {
        actions.append(cancelButton, saveButton);
    }
    else {
        actions.appendChild(cancelButton);
        actions.appendChild(saveButton);
    }
    if (typeof panel.append === "function") {
        panel.append(heading, preview.root, textarea, feedback, actions);
    }
    else {
        panel.appendChild(heading);
        panel.appendChild(preview.root);
        panel.appendChild(textarea);
        panel.appendChild(feedback);
        panel.appendChild(actions);
    }
    host.appendChild(panel);
    let visible = false;
    let state = {
        status: "closed",
        noteText: "",
        errorMessage: "",
        selectionRect: null,
    };
    function ensureMounted() {
        if (host.parentNode || host.parentElement) {
            return;
        }
        (documentRef.body || documentRef.documentElement)?.appendChild(host);
    }
    function updatePosition(rect) {
        const panelRect = typeof panel.getBoundingClientRect === "function"
            ? panel.getBoundingClientRect()
            : { width: 320, height: 260 };
        const position = computePillPosition({
            rect,
            viewportWidth: Number(windowRef?.innerWidth || 1024),
            viewportHeight: Number(windowRef?.innerHeight || 768),
            panelWidth: Number(panelRect?.width || 320),
            panelHeight: Number(panelRect?.height || 260),
        });
        panel.style.left = `${position.left}px`;
        panel.style.top = `${position.top}px`;
    }
    function render(viewModel = {}) {
        state = {
            ...state,
            status: viewModel.status || state.status,
            noteText: typeof viewModel.noteText === "string" ? viewModel.noteText : state.noteText,
            errorMessage: viewModel.errorMessage || "",
            selectionRect: viewModel.selectionRect || state.selectionRect,
        };
        ensureMounted();
        host.style.display = visible ? "block" : "none";
        panel.style.display = visible ? "grid" : "none";
        textarea.value = state.noteText;
        preview.render({
            text: viewModel.selectionText,
            pageTitle: viewModel.pageTitle,
            pageUrl: viewModel.pageUrl,
        });
        if (state.selectionRect) {
            updatePosition(state.selectionRect);
        }
        const saving = state.status === "saving";
        setDisabled(textarea, saving);
        setDisabled(cancelButton, saving);
        setDisabled(saveButton, saving || !String(state.noteText || "").trim());
        saveButton.textContent = saving ? "Saving" : "Save note";
        if (state.status === "error") {
            feedback.textContent = state.errorMessage || "Save failed.";
            feedback.style.color = "#fca5a5";
        }
        else if (state.status === "success") {
            feedback.textContent = "Note saved.";
            feedback.style.color = "#86efac";
        }
        else if (saving) {
            feedback.textContent = "Saving note...";
            feedback.style.color = "#93c5fd";
        }
        else {
            feedback.textContent = "";
            feedback.style.color = "#94a3b8";
        }
    }
    textarea.addEventListener("input", () => {
        onInput?.(textarea.value);
    });
    textarea.addEventListener("keydown", (event) => {
        if ((event?.ctrlKey || event?.metaKey) && String(event?.key || "").toLowerCase() === "enter") {
            event.preventDefault?.();
            void onSave?.();
            return;
        }
        if (String(event?.key || "").toLowerCase() === "escape") {
            event.preventDefault?.();
            onCancel?.();
        }
    });
    cancelButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onCancel?.();
    });
    saveButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        void onSave?.();
    });
    panel.addEventListener("click", (event) => {
        event.stopPropagation?.();
    });
    return {
        host,
        panel,
        textarea,
        show(viewModel = {}) {
            visible = true;
            render(viewModel);
        },
        hide() {
            visible = false;
            state = {
                status: "closed",
                noteText: state.noteText,
                errorMessage: "",
                selectionRect: state.selectionRect,
            };
            host.style.display = "none";
            panel.style.display = "none";
        },
        render,
        isVisible() {
            return visible;
        },
        isInsidePanel(target) {
            let current = target || null;
            while (current) {
                if (current === host || current === panel) {
                    return true;
                }
                if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
                    return true;
                }
                current = current.parentNode || current.parentElement || null;
            }
            return false;
        },
        getState() {
            return {
                visible,
                ...state,
            };
        },
        focusInput() {
            textarea.focus?.();
        },
        destroy() {
            host.remove?.();
        },
    };
}
