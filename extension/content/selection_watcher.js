export function createSelectionWatcher({ onSelectionChange }) {
  let lastSignature = "";

  function isEditable(node) {
    if (!node || typeof Element === "undefined" || !(node instanceof Element)) return false;
    if (node.closest("input, textarea, [contenteditable='true']")) return true;
    return false;
  }

  function currentSelectionPayload() {
    const selection = window.getSelection();
    const text = selection ? String(selection || "").trim() : "";
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed) {
      return { text: "", rect: null };
    }
    const elementNode = typeof Node === "undefined" ? 1 : Node.ELEMENT_NODE;
    const anchorElement = selection?.anchorNode?.nodeType === elementNode
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement || null;
    if (isEditable(anchorElement)) {
      return { text: "", rect: null };
    }
    let rect = range.getBoundingClientRect();
    if ((!rect || (!rect.width && !rect.height)) && range.getClientRects?.().length) {
      rect = range.getClientRects()[0];
    }
    return {
      text,
      rect: rect && Number.isFinite(rect.top) ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      } : null,
    };
  }

  function emit() {
    const payload = currentSelectionPayload();
    const signature = `${payload.text}|${payload.rect?.top || 0}|${payload.rect?.left || 0}|${payload.rect?.width || 0}|${payload.rect?.height || 0}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    onSelectionChange(payload);
  }

  document.addEventListener("selectionchange", emit);
  window.addEventListener("scroll", emit, { passive: true });
  window.addEventListener("resize", emit, { passive: true });

  return {
    stop() {
      document.removeEventListener("selectionchange", emit);
      window.removeEventListener("scroll", emit);
      window.removeEventListener("resize", emit);
    },
  };
}
