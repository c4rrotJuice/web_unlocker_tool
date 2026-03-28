function extractHeadingItemsFromDom(quillAdapter) {
  const root = quillAdapter?.root;
  const quill = quillAdapter?.quill;
  const find = typeof window !== "undefined" ? window.Quill?.find : null;
  if (!root?.querySelectorAll || !quill || typeof find !== "function") return null;

  const headingNodes = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  return headingNodes.map((node) => {
    const level = Number(node.tagName.slice(1));
    const blot = find(node);
    const index = blot && typeof quill.getIndex === "function" ? quill.getIndex(blot) : 0;
    return {
      level,
      text: (node.textContent || "").trim(),
      index,
    };
  }).filter((item) => item.text && Number.isInteger(item.level) && item.level >= 1 && item.level <= 6);
}

function extractHeadingItemsFromDelta(delta) {
  const items = [];
  const ops = delta?.ops || [];
  let lineText = "";
  let lineStartIndex = 0;
  let index = 0;

  for (const op of ops) {
    if (typeof op.insert === "string") {
      for (const char of op.insert) {
        if (char === "\n") {
          const level = Number(op.attributes?.header);
          const text = lineText.trim();
          if (Number.isInteger(level) && level >= 1 && level <= 6 && text) {
            items.push({ text, level, index: lineStartIndex });
          }
          index += 1;
          lineText = "";
          lineStartIndex = index;
        } else {
          lineText += char;
          index += 1;
        }
      }
      continue;
    }

    index += 1;
  }

  return items;
}

export function createOutlineController({ refs = {}, quillAdapter }) {
  let timer = null;
  let target = refs.outlineList || null;
  let lastItems = [];

  function render(items, renderTarget = target) {
    if (!renderTarget) return;
    renderTarget.innerHTML = items.length
      ? items.map((item) => `<button class="editor-v2-link" type="button" data-outline-index="${item.index}">${"&nbsp;".repeat(Math.max(item.level - 1, 0) * 2)}${item.text}</button>`).join("")
      : `<div class="editor-v2-card">No headings yet.</div>`;
  }

  function compute() {
    const items = extractHeadingItemsFromDom(quillAdapter) ?? extractHeadingItemsFromDelta(quillAdapter.getContents());
    lastItems = items;
    render(items);
    return items;
  }

  function schedule() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      compute();
    }, 250);
  }

  const onClick = (event) => {
    const button = event.target.closest("[data-outline-index]");
    if (!button) return;
    quillAdapter.focus();
    quillAdapter.setSelection(Number(button.dataset.outlineIndex) || 0, 0, "user");
  };

  return {
    compute,
    schedule,
    setTarget(nextTarget) {
      target = nextTarget || null;
      render(lastItems);
    },
    clearTarget() {
      if (target) target.innerHTML = "";
      target = null;
    },
    handleClick: onClick,
    dispose() {
      if (timer) window.clearTimeout(timer);
    },
  };
}
