function structuralChange(delta) {
  return (delta?.ops || []).some((op) => {
    const attrs = op.attributes || {};
    return typeof op.insert === "string" && op.insert.includes("\n")
      || "header" in attrs
      || "blockquote" in attrs
      || "list" in attrs;
  });
}

export function createOutlineController({ refs, quillAdapter }) {
  let timer = null;

  function render(items) {
    refs.outlineList.innerHTML = items.length
      ? items.map((item) => `<button class="editor-v2-link" type="button" data-outline-index="${item.index}">${"&nbsp;".repeat(Math.max(item.level - 1, 0) * 2)}${item.text}</button>`).join("")
      : `<div class="editor-v2-card">No headings yet.</div>`;
  }

  function compute() {
    const ops = quillAdapter.getContents().ops || [];
    const items = [];
    let runningIndex = 0;
    for (const op of ops) {
      const insert = typeof op.insert === "string" ? op.insert : "";
      const text = insert.trim();
      const level = op.attributes?.header;
      if (level && text) {
        items.push({ text, level, index: runningIndex });
      }
      runningIndex += insert.length;
    }
    render(items);
  }

  function schedule(delta) {
    if (!structuralChange(delta)) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(compute, 250);
  }

  const onClick = (event) => {
    const button = event.target.closest("[data-outline-index]");
    if (!button) return;
    quillAdapter.focus();
    quillAdapter.setSelection(Number(button.dataset.outlineIndex) || 0, 0, "user");
  };
  refs.outlineList.addEventListener("click", onClick);

  return {
    compute,
    schedule,
    dispose() {
      if (timer) window.clearTimeout(timer);
      refs.outlineList.removeEventListener("click", onClick);
    },
  };
}
