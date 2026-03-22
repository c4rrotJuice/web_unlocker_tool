// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
function setDisabled(element, disabled) {
    element.disabled = disabled;
    if (disabled) {
        element.setAttribute("aria-disabled", "true");
    }
    else if (typeof element.removeAttribute === "function") {
        element.removeAttribute("aria-disabled");
    }
}
export function createNewNoteView({ documentRef = globalThis.document, onOpen, onCancel, onInput, onSubmit, } = {}) {
    const root = documentRef.createElement("section");
    const heading = documentRef.createElement("div");
    const toggle = documentRef.createElement("button");
    const composer = documentRef.createElement("div");
    const context = documentRef.createElement("p");
    const textarea = documentRef.createElement("textarea");
    const feedback = documentRef.createElement("p");
    const actions = documentRef.createElement("div");
    const cancelButton = documentRef.createElement("button");
    const saveButton = documentRef.createElement("button");
    root.setAttribute("data-new-note-view", "true");
    root.style.display = "grid";
    root.style.gap = "12px";
    heading.textContent = "New Note";
    heading.style.fontSize = "13px";
    heading.style.textTransform = "uppercase";
    heading.style.letterSpacing = "0.08em";
    heading.style.color = "#64748b";
    toggle.type = "button";
    toggle.textContent = "New note";
    toggle.setAttribute("data-note-open", "true");
    toggle.style.padding = "10px 12px";
    toggle.style.borderRadius = "14px";
    toggle.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    toggle.style.background = "#e2e8f0";
    toggle.style.color = "#0f172a";
    composer.style.display = "none";
    composer.style.gap = "10px";
    context.style.margin = "0";
    context.style.fontSize = "12px";
    context.style.lineHeight = "1.4";
    context.style.color = "#64748b";
    textarea.rows = 8;
    textarea.placeholder = "Write a plain note";
    textarea.setAttribute("data-note-text", "true");
    textarea.style.padding = "12px";
    textarea.style.borderRadius = "14px";
    textarea.style.border = "1px solid rgba(148, 163, 184, 0.22)";
    textarea.style.background = "#ffffff";
    textarea.style.color = "#0f172a";
    textarea.style.resize = "vertical";
    textarea.style.fontFamily = "Georgia, 'Times New Roman', serif";
    textarea.style.fontSize = "14px";
    textarea.style.lineHeight = "1.5";
    feedback.style.margin = "0";
    feedback.style.minHeight = "18px";
    feedback.style.fontSize = "12px";
    feedback.style.lineHeight = "1.35";
    actions.style.display = "flex";
    actions.style.gap = "8px";
    for (const button of [cancelButton, saveButton]) {
        button.type = "button";
        button.style.padding = "9px 12px";
        button.style.borderRadius = "999px";
        button.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    }
    cancelButton.textContent = "Cancel";
    cancelButton.style.background = "#ffffff";
    cancelButton.style.color = "#0f172a";
    saveButton.textContent = "Save note";
    saveButton.setAttribute("data-note-save", "true");
    saveButton.style.background = "#0f172a";
    saveButton.style.color = "#f8fafc";
    actions.appendChild(cancelButton);
    actions.appendChild(saveButton);
    composer.appendChild(context);
    composer.appendChild(textarea);
    composer.appendChild(feedback);
    composer.appendChild(actions);
    root.appendChild(heading);
    root.appendChild(toggle);
    root.appendChild(composer);
    let state = {
        status: "closed",
        noteText: "",
        errorMessage: "",
        pageContextText: "",
    };
    function render(nextState = {}) {
        state = {
            ...state,
            ...nextState,
        };
        const isOpen = state.status !== "closed";
        toggle.style.display = isOpen ? "none" : "inline-flex";
        composer.style.display = isOpen ? "grid" : "none";
        textarea.value = state.noteText || "";
        context.textContent = state.pageContextText || "Page context will be attached when available.";
        const saving = state.status === "saving";
        setDisabled(textarea, saving);
        setDisabled(cancelButton, saving);
        setDisabled(saveButton, saving || !String(state.noteText || "").trim());
        saveButton.textContent = saving ? "Saving" : "Save note";
        if (state.status === "error") {
            feedback.textContent = state.errorMessage || "Save failed.";
            feedback.style.color = "#b91c1c";
        }
        else if (state.status === "success") {
            feedback.textContent = "Note saved.";
            feedback.style.color = "#15803d";
        }
        else if (saving) {
            feedback.textContent = "Saving note...";
            feedback.style.color = "#1d4ed8";
        }
        else {
            feedback.textContent = "";
            feedback.style.color = "#64748b";
        }
    }
    toggle.addEventListener("click", (event) => {
        event.preventDefault?.();
        onOpen?.();
    });
    textarea.addEventListener("input", () => {
        onInput?.(textarea.value);
    });
    textarea.addEventListener("keydown", (event) => {
        if ((event?.ctrlKey || event?.metaKey) && String(event?.key || "").toLowerCase() === "enter") {
            event.preventDefault?.();
            void onSubmit?.();
            return;
        }
        if (String(event?.key || "").toLowerCase() === "escape") {
            event.preventDefault?.();
            onCancel?.();
        }
    });
    cancelButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        onCancel?.();
    });
    saveButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        void onSubmit?.();
    });
    return {
        root,
        textarea,
        render,
        focusInput() {
            textarea.focus?.();
        },
        getState() {
            return { ...state };
        },
    };
}
