export function createEmptyStateCard({
  documentRef = globalThis.document,
  title = "Nothing here yet",
  body = "",
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-empty-state-card", "true");
  root.style.display = "grid";
  root.style.gap = "8px";
  root.style.padding = "18px 16px";
  root.style.borderRadius = "18px";
  root.style.border = "1px dashed rgba(148, 163, 184, 0.40)";
  root.style.background = "#ffffff";

  const heading = documentRef.createElement("div");
  heading.style.fontSize = "14px";
  heading.style.fontWeight = "700";
  heading.style.color = "#0f172a";

  const message = documentRef.createElement("div");
  message.style.fontSize = "13px";
  message.style.color = "#64748b";
  message.style.lineHeight = "1.5";

  function render(nextTitle = title, nextBody = body) {
    heading.textContent = nextTitle;
    message.textContent = nextBody;
  }

  render();
  root.appendChild(heading);
  root.appendChild(message);
  return { root, render };
}
