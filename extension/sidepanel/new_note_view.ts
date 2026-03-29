function setDisabled(element: any, disabled: boolean) {
  element.disabled = disabled;
  if (disabled) {
    element.setAttribute("aria-disabled", "true");
  } else if (typeof element.removeAttribute === "function") {
    element.removeAttribute("aria-disabled");
  }
}

function clearChildren(node: any) {
  if (typeof node?.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  if ("innerHTML" in node) {
    node.innerHTML = "";
    return;
  }
  if (Array.isArray(node?.children)) {
    node.children.length = 0;
  }
}

export function createNewNoteView({
  documentRef = globalThis.document,
  onOpen,
  onCancel,
  onInput,
  onProjectChange,
  onTagsChange,
  onSubmit,
}: {
  documentRef?: Document;
  onOpen?: () => void;
  onCancel?: () => void;
  onInput?: (value: string) => void;
  onProjectChange?: (value: string) => void;
  onTagsChange?: (value: string[]) => void;
  onSubmit?: () => void | Promise<void>;
} = {}) {
  const root = documentRef.createElement("section");
  const heading = documentRef.createElement("div");
  const toggle = documentRef.createElement("button");
  const composer = documentRef.createElement("div");
  const context = documentRef.createElement("p");
  const linkingHint = documentRef.createElement("p");
  const projectLabel = documentRef.createElement("label");
  const projectSelect = documentRef.createElement("select");
  const tagsLabel = documentRef.createElement("div");
  const tagsWrap = documentRef.createElement("div");
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

  linkingHint.style.margin = "0";
  linkingHint.style.fontSize = "12px";
  linkingHint.style.lineHeight = "1.4";
  linkingHint.style.color = "#475569";

  projectLabel.textContent = "Project";
  projectLabel.style.display = "grid";
  projectLabel.style.gap = "6px";
  projectLabel.style.fontSize = "12px";
  projectLabel.style.color = "#475569";

  projectSelect.setAttribute("data-note-project-select", "true");
  projectSelect.style.padding = "10px 12px";
  projectSelect.style.borderRadius = "12px";
  projectSelect.style.border = "1px solid rgba(148, 163, 184, 0.22)";
  projectSelect.style.background = "#ffffff";
  projectSelect.style.color = "#0f172a";

  tagsLabel.textContent = "Tags";
  tagsLabel.style.fontSize = "12px";
  tagsLabel.style.color = "#475569";

  tagsWrap.style.display = "flex";
  tagsWrap.style.flexWrap = "wrap";
  tagsWrap.style.gap = "8px";

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
  composer.appendChild(linkingHint);
  projectLabel.appendChild(projectSelect);
  composer.appendChild(projectLabel);
  composer.appendChild(tagsLabel);
  composer.appendChild(tagsWrap);
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
    linkingText: "",
    projectOptions: [],
    selectedProjectId: "",
    tagOptions: [],
    selectedTagIds: [],
  };

  function renderProjectOptions() {
    clearChildren(projectSelect);
    const emptyOption = documentRef.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No project";
    projectSelect.appendChild(emptyOption);
    for (const option of Array.isArray(state.projectOptions) ? state.projectOptions : []) {
      const node = documentRef.createElement("option");
      node.value = String(option?.id || "");
      node.textContent = String(option?.name || option?.label || option?.id || "");
      node.selected = node.value === state.selectedProjectId;
      projectSelect.appendChild(node);
    }
    projectSelect.value = state.selectedProjectId || "";
  }

  function renderTagOptions() {
    clearChildren(tagsWrap);
    const selected = new Set(Array.isArray(state.selectedTagIds) ? state.selectedTagIds : []);
    const options = Array.isArray(state.tagOptions) ? state.tagOptions : [];
    if (!options.length) {
      const empty = documentRef.createElement("div");
      empty.textContent = "No recent tags";
      empty.style.fontSize = "12px";
      empty.style.color = "#94a3b8";
      tagsWrap.appendChild(empty);
      return;
    }
    for (const option of options) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.setAttribute("data-note-tag", String(option?.id || ""));
      const isSelected = selected.has(String(option?.id || ""));
      button.textContent = String(option?.name || option?.label || option?.id || "");
      button.style.padding = "7px 10px";
      button.style.borderRadius = "999px";
      button.style.border = isSelected
        ? "1px solid rgba(15, 23, 42, 0.56)"
        : "1px solid rgba(148, 163, 184, 0.24)";
      button.style.background = isSelected ? "#0f172a" : "#ffffff";
      button.style.color = isSelected ? "#f8fafc" : "#0f172a";
      button.addEventListener("click", (event: any) => {
        event.preventDefault?.();
        const next = new Set(Array.isArray(state.selectedTagIds) ? state.selectedTagIds : []);
        const optionId = String(option?.id || "");
        if (next.has(optionId)) {
          next.delete(optionId);
        } else if (optionId) {
          next.add(optionId);
        }
        onTagsChange?.(Array.from(next));
      });
      tagsWrap.appendChild(button);
    }
  }

  function render(nextState: any = {}) {
    state = {
      ...state,
      ...nextState,
    };
    const isOpen = state.status !== "closed";
    toggle.style.display = isOpen ? "none" : "inline-flex";
    composer.style.display = isOpen ? "grid" : "none";
    textarea.value = state.noteText || "";
    context.textContent = state.pageContextText || "Page context will be attached when available.";
    linkingHint.textContent = state.linkingText || "Current page attaches when available. Open in Editor to Link related notes or Convert quotes.";
    state.selectedProjectId = String(state.selectedProjectId || "");
    state.selectedTagIds = Array.isArray(state.selectedTagIds) ? state.selectedTagIds.map((value) => String(value || "")).filter(Boolean) : [];
    renderProjectOptions();
    renderTagOptions();
    const saving = state.status === "saving";
    setDisabled(textarea, saving);
    setDisabled(projectSelect, saving);
    setDisabled(cancelButton, saving);
    setDisabled(saveButton, saving || !String(state.noteText || "").trim());
    saveButton.textContent = saving ? "Saving" : "Save note";
    if (state.status === "error") {
      feedback.textContent = state.errorMessage || "Note save failed.";
      feedback.style.color = "#b91c1c";
    } else if (state.status === "success") {
      feedback.textContent = "Note saved with attached evidence.";
      feedback.style.color = "#15803d";
    } else if (saving) {
      feedback.textContent = "Saving note...";
      feedback.style.color = "#1d4ed8";
    } else {
      feedback.textContent = "";
      feedback.style.color = "#64748b";
    }
  }

  toggle.addEventListener("click", (event: any) => {
    event.preventDefault?.();
    onOpen?.();
  });
  textarea.addEventListener("input", () => {
    onInput?.(textarea.value);
  });
  projectSelect.addEventListener("change", () => {
    onProjectChange?.(projectSelect.value);
  });
  textarea.addEventListener("keydown", (event: any) => {
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
  cancelButton.addEventListener("click", (event: any) => {
    event.preventDefault?.();
    onCancel?.();
  });
  saveButton.addEventListener("click", (event: any) => {
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
