export function createNewNoteView({
  documentRef = globalThis.document,
  draft = { title: "", body: "" },
  actionAvailability = {},
  onChange,
  onSubmit,
  onWorkInEditor,
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-new-note-view", "true");
  root.style.display = "grid";
  root.style.gap = "12px";
  root.style.padding = "0";

  const heading = documentRef.createElement("div");
  heading.textContent = "New Note";
  heading.style.fontSize = "13px";
  heading.style.textTransform = "uppercase";
  heading.style.letterSpacing = "0.08em";
  heading.style.color = "#94a3b8";

  const titleInput = documentRef.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Title";
  titleInput.value = draft.title || "";
  titleInput.style.padding = "11px 12px";
  titleInput.style.borderRadius = "14px";
  titleInput.style.border = "1px solid rgba(148, 163, 184, 0.22)";
  titleInput.style.background = "rgba(15, 23, 42, 0.72)";
  titleInput.style.color = "#f8fafc";

  const bodyInput = documentRef.createElement("textarea");
  bodyInput.placeholder = "Write a plain note";
  bodyInput.value = draft.body || "";
  bodyInput.rows = 8;
  bodyInput.style.padding = "12px";
  bodyInput.style.borderRadius = "14px";
  bodyInput.style.border = "1px solid rgba(148, 163, 184, 0.22)";
  bodyInput.style.background = "rgba(15, 23, 42, 0.72)";
  bodyInput.style.color = "#f8fafc";
  bodyInput.style.resize = "vertical";

  const actions = documentRef.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";

  const submit = documentRef.createElement("button");
  submit.type = "button";
  submit.textContent = "Save note";
  submit.style.padding = "9px 12px";
  submit.style.borderRadius = "999px";
  submit.style.border = "1px solid rgba(148, 163, 184, 0.24)";
  submit.style.background = "rgba(14, 165, 233, 0.18)";
  submit.style.color = "#f8fafc";
  submit.setAttribute("aria-keyshortcuts", "Ctrl+Enter");

  function updateDraft() {
    onChange?.({ title: titleInput.value, body: bodyInput.value });
  }

  titleInput.addEventListener("input", updateDraft);
  bodyInput.addEventListener("input", updateDraft);
  bodyInput.addEventListener("keydown", (event) => {
    if ((event?.ctrlKey || event?.metaKey) && String(event?.key || "").toLowerCase() === "enter") {
      event.preventDefault();
      onSubmit?.({ title: titleInput.value, body: bodyInput.value });
    }
  });
  submit.addEventListener("click", (event) => {
    event.preventDefault();
    onSubmit?.({ title: titleInput.value, body: bodyInput.value });
  });

  const editor = documentRef.createElement("button");
  editor.type = "button";
  editor.textContent = "Editor";
  editor.style.padding = "9px 12px";
  editor.style.borderRadius = "999px";
  editor.style.border = "1px solid rgba(148, 163, 184, 0.24)";
  editor.style.background = "rgba(34, 197, 94, 0.16)";
  editor.style.color = "#f8fafc";
  editor.setAttribute("aria-keyshortcuts", "Ctrl+Shift+E");
  const canWorkInEditor = actionAvailability.work_in_editor !== false;
  if (!canWorkInEditor) {
    editor.disabled = true;
    editor.setAttribute("data-locked", "true");
    editor.setAttribute("aria-disabled", "true");
    editor.style.opacity = "0.5";
    editor.style.cursor = "not-allowed";
  }
  editor.addEventListener("click", (event) => {
    event.preventDefault();
    if (canWorkInEditor) {
      onWorkInEditor?.({ title: titleInput.value, body: bodyInput.value });
    }
  });

  actions.appendChild(submit);
  actions.appendChild(editor);
  root.appendChild(heading);
  root.appendChild(titleInput);
  root.appendChild(bodyInput);
  root.appendChild(actions);

  return {
    root,
    render(nextDraft = draft) {
      titleInput.value = nextDraft.title || "";
      bodyInput.value = nextDraft.body || "";
    },
  };
}
