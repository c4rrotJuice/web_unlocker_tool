export function createSelectionWatcher({ onSelectionChange }) {
  let lastSelection = "";

  function currentSelectionPayload() {
    const selection = window.getSelection();
    const text = selection ? String(selection).trim() : "";
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    const rect = range ? range.getBoundingClientRect() : null;
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
    if (payload.text === lastSelection && payload.rect) return;
    lastSelection = payload.text;
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

