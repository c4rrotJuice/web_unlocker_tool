export function createStatusBanner({
  documentRef = globalThis.document,
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-status-banner", "true");
  root.style.display = "none";
  root.style.padding = "10px 12px";
  root.style.borderRadius = "14px";
  root.style.fontSize = "13px";
  root.style.lineHeight = "1.45";

  function render(notice = null) {
    if (!notice?.message) {
      root.style.display = "none";
      root.textContent = "";
      return;
    }
    root.style.display = "block";
    root.textContent = notice.message;
    if (notice.tone === "error") {
      root.style.background = "#fef2f2";
      root.style.color = "#991b1b";
      root.style.border = "1px solid #fecaca";
      return;
    }
    root.style.background = "#eff6ff";
    root.style.color = "#1d4ed8";
    root.style.border = "1px solid #bfdbfe";
  }

  return { root, render };
}
