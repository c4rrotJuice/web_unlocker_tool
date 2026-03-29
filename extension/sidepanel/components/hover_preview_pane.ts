function truncate(value, maxLength = 520) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

export function createHoverPreviewPane({ documentRef = globalThis.document } = {}) {
  const root = documentRef.createElement("aside");
  root.setAttribute("data-hover-preview-pane", "true");
  root.style.position = "absolute";
  root.style.left = "8px";
  root.style.top = "8px";
  root.style.width = "min(280px, calc(100% - 24px))";
  root.style.padding = "14px";
  root.style.borderRadius = "14px";
  root.style.border = "1px solid rgba(148, 163, 184, 0.16)";
  root.style.background = "rgba(2, 6, 23, 0.96)";
  root.style.boxShadow = "0 18px 40px rgba(2, 6, 23, 0.36)";
  root.style.display = "none";
  root.style.zIndex = "2";
  const content = documentRef.createElement("div");
  root.append(content);

  let hideTimer: any = null;
  let pinned = false;

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function applyTone(tone = "default") {
    if (tone === "edit") {
      root.style.border = "1px solid rgba(34, 197, 94, 0.34)";
      root.style.background = "linear-gradient(180deg, rgba(6, 78, 59, 0.96) 0%, rgba(2, 44, 34, 0.98) 100%)";
      root.style.boxShadow = "0 18px 40px rgba(4, 120, 87, 0.24)";
      return;
    }
    root.style.border = "1px solid rgba(148, 163, 184, 0.16)";
    root.style.background = "rgba(2, 6, 23, 0.96)";
    root.style.boxShadow = "0 18px 40px rgba(2, 6, 23, 0.36)";
  }

  function setTop(top) {
    root.style.top = `${Math.max(8, Number(top) || 8)}px`;
  }

  function setPinned(nextPinned = false) {
    pinned = Boolean(nextPinned);
  }

  function mount(node, payload: any = {}) {
    clearHideTimer();
    applyTone(payload.tone || "default");
    setPinned(payload.pinned);
    content.replaceChildren(node);
    setTop(payload.top);
    root.style.display = "block";
  }

  function render(payload: any = {}) {
    const title = documentRef.createElement("div");
    title.style.fontSize = "14px";
    title.style.fontWeight = "700";
    title.style.lineHeight = "1.35";
    title.style.color = "#f8fafc";
    title.textContent = truncate(payload.title || "Preview", 140) || "Preview";

    const meta = documentRef.createElement("div");
    meta.style.marginTop = "6px";
    meta.style.fontSize = "11px";
    meta.style.lineHeight = "1.4";
    meta.style.color = "#94a3b8";
    meta.textContent = truncate(payload.meta || "", 180);

    const body = documentRef.createElement("div");
    body.style.marginTop = "10px";
    body.style.fontSize = "12px";
    body.style.lineHeight = "1.5";
    body.style.color = "#cbd5e1";
    body.style.whiteSpace = "pre-wrap";
    body.style.wordBreak = "break-word";
    body.style.overflowWrap = "anywhere";
    body.textContent = truncate(payload.body || "", 520) || "Preview unavailable.";

    const node = documentRef.createElement("div");
    node.append(title, meta, body);
    mount(node, payload);
  }

  function hide(delay = 120, force = false) {
    if (pinned && !force) {
      return;
    }
    clearHideTimer();
    hideTimer = setTimeout(() => {
      root.style.display = "none";
      setPinned(false);
    }, delay);
  }

  function clear(force = false) {
    content.replaceChildren();
    hide(0, force);
    applyTone("default");
  }

  root.addEventListener("mouseenter", () => clearHideTimer());
  root.addEventListener("mouseleave", () => hide(120));

  return { root, render, mount, hide, clear, setPinned };
}
