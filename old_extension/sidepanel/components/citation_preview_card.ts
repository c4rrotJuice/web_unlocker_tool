export function createCitationPreviewCard({
  documentRef = globalThis.document,
  title = "Preview",
  text = "",
  loading = false,
  error = null,
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-citation-preview-card", "true");
  root.style.border = "1px solid rgba(148, 163, 184, 0.2)";
  root.style.borderRadius = "18px";
  root.style.background = "rgba(15, 23, 42, 0.72)";
  root.style.padding = "16px";
  root.style.minHeight = "140px";
  root.style.display = "grid";
  root.style.gap = "12px";

  const heading = documentRef.createElement("div");
  heading.textContent = title;
  heading.style.fontSize = "12px";
  heading.style.letterSpacing = "0.08em";
  heading.style.textTransform = "uppercase";
  heading.style.color = "#94a3b8";

  const body = documentRef.createElement("div");
  body.setAttribute("data-citation-preview-body", "true");
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  body.style.overflowWrap = "anywhere";
  body.style.lineHeight = "1.65";
  body.style.color = "#f8fafc";
  body.style.fontSize = "15px";

  function render(nextText = text, nextLoading = loading, nextError = error) {
    body.innerHTML = "";
    if (nextLoading) {
      body.textContent = "Loading citation preview";
      return;
    }
    if (nextError) {
      body.textContent = typeof nextError.message === "string" ? nextError.message : "Citation preview unavailable.";
      body.style.color = "#fca5a5";
      return;
    }
    body.style.color = "#f8fafc";
    body.textContent = nextText || "No citation preview available.";
  }

  render(text, loading, error);
  root.appendChild(heading);
  root.appendChild(body);

  return {
    root,
    body,
    render,
  };
}
