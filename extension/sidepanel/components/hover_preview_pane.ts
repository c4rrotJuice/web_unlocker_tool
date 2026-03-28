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

  const title = documentRef.createElement("div");
  title.style.fontSize = "14px";
  title.style.fontWeight = "700";
  title.style.lineHeight = "1.35";
  title.style.color = "#f8fafc";

  const meta = documentRef.createElement("div");
  meta.style.marginTop = "6px";
  meta.style.fontSize = "11px";
  meta.style.lineHeight = "1.4";
  meta.style.color = "#94a3b8";

  const body = documentRef.createElement("div");
  body.style.marginTop = "10px";
  body.style.fontSize = "12px";
  body.style.lineHeight = "1.5";
  body.style.color = "#cbd5e1";
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  body.style.overflowWrap = "anywhere";

  root.append(title, meta, body);

  let hideTimer: any = null;

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function render(payload: any = {}) {
    clearHideTimer();
    title.textContent = truncate(payload.title || "Preview", 140) || "Preview";
    meta.textContent = truncate(payload.meta || "", 180);
    body.textContent = truncate(payload.body || "", 520) || "Preview unavailable.";
    root.style.top = `${Math.max(8, Number(payload.top) || 8)}px`;
    root.style.display = "block";
  }

  function hide(delay = 120) {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      root.style.display = "none";
    }, delay);
  }

  root.addEventListener("mouseenter", () => clearHideTimer());
  root.addEventListener("mouseleave", () => hide(120));

  return { root, render, hide };
}
