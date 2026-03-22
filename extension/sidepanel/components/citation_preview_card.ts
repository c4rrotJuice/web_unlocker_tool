export function createCitationPreviewCard({
  documentRef = globalThis.document,
  title = "Backend-derived preview",
}: any = {}) {
  const root = documentRef.createElement("section");
  const heading = documentRef.createElement("div");
  const body = documentRef.createElement("div");

  root.setAttribute("data-citation-preview-card", "true");
  root.style.display = "grid";
  root.style.gap = "12px";
  root.style.padding = "16px";
  root.style.borderRadius = "18px";
  root.style.border = "1px solid rgba(148, 163, 184, 0.2)";
  root.style.background = "rgba(15, 23, 42, 0.72)";
  root.style.minHeight = "144px";

  heading.textContent = title;
  heading.style.fontSize = "12px";
  heading.style.letterSpacing = "0.08em";
  heading.style.textTransform = "uppercase";
  heading.style.color = "#94a3b8";

  body.setAttribute("data-citation-preview-body", "true");
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  body.style.overflowWrap = "anywhere";
  body.style.userSelect = "text";
  body.style.webkitUserSelect = "text";
  body.style.lineHeight = "1.65";
  body.style.color = "#f8fafc";
  body.style.fontSize = "15px";

  root.appendChild(heading);
  root.appendChild(body);

  return {
    root,
    body,
    render({ text = "", loading = false, error = null } = {}) {
      if (loading) {
        body.textContent = "Loading citation preview";
        body.style.color = "#cbd5e1";
        return;
      }
      if (error) {
        body.textContent = error.message || "Citation preview unavailable.";
        body.style.color = "#fca5a5";
        return;
      }
      body.textContent = text || "No citation preview available.";
      body.style.color = "#f8fafc";
    },
  };
}
