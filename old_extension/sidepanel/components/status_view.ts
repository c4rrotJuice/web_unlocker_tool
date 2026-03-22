export function createStatusView({
  documentRef = globalThis.document,
  title = "Loading",
  message = "",
  tone = "neutral",
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-status-view", "true");
  root.style.display = "grid";
  root.style.gap = "8px";
  root.style.padding = "18px 16px";
  root.style.borderRadius = "18px";
  root.style.border = "1px solid rgba(148, 163, 184, 0.18)";
  root.style.background = tone === "error" ? "rgba(127, 29, 29, 0.24)" : "rgba(15, 23, 42, 0.72)";

  const heading = documentRef.createElement("div");
  heading.style.fontSize = "14px";
  heading.style.fontWeight = "700";
  heading.style.color = tone === "error" ? "#fecaca" : "#f8fafc";
  heading.textContent = title;

  const body = documentRef.createElement("div");
  body.style.color = tone === "error" ? "#fecaca" : "#cbd5e1";
  body.style.lineHeight = "1.5";
  body.textContent = message;

  root.appendChild(heading);
  root.appendChild(body);

  return {
    root,
    render(nextTitle = title, nextMessage = message, nextTone = tone) {
      heading.textContent = nextTitle;
      body.textContent = nextMessage;
      root.style.background = nextTone === "error" ? "rgba(127, 29, 29, 0.24)" : "rgba(15, 23, 42, 0.72)";
      heading.style.color = nextTone === "error" ? "#fecaca" : "#f8fafc";
      body.style.color = nextTone === "error" ? "#fecaca" : "#cbd5e1";
    },
  };
}
