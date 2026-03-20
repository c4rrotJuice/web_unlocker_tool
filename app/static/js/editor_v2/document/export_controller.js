export function createExportController({ workspaceState, quillAdapter, eventBus }) {
  function exportHtmlDocument(content) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Writior Export</title>
    <style>
      body {
        margin: 2rem auto;
        max-width: 52rem;
        padding: 0 1rem;
        color: #0f172a;
        background: #ffffff;
        font: 400 16px/1.65 Georgia, "Times New Roman", serif;
      }
      h1, h2, h3 {
        line-height: 1.25;
        margin-top: 1.2em;
        margin-bottom: 0.55em;
      }
      p {
        margin: 0.45em 0 0.7em;
      }
      blockquote {
        border-left: 3px solid rgba(15, 23, 42, 0.25);
        margin: 1rem 0;
        padding: 0.25rem 0 0.25rem 0.9rem;
      }
      .ql-align-center { text-align: center; }
      .ql-align-right { text-align: right; }
      .ql-align-justify { text-align: justify; }
      .editor-v2-chip,
      .editor-v2-chip-note {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        border-radius: 999px;
        padding: 0.1rem 0.4rem;
        font-size: 0.93em;
      }
      .editor-v2-chip {
        color: #115e59;
        background: rgba(15, 118, 110, 0.14);
      }
      .editor-v2-chip-note {
        color: #92400e;
        background: rgba(180, 83, 9, 0.14);
      }
      a {
        color: #0f766e;
      }
    </style>
  </head>
  <body>
${content}
  </body>
</html>`;
  }

  function exportHtml() {
    const state = workspaceState.getState();
    if (!state.active_document || state.save_status === "error") {
      eventBus?.emit("document.export.failed", { message: "This document cannot be exported right now." });
      return;
    }
    const blob = new Blob([exportHtmlDocument(quillAdapter.getHTML())], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(state.active_document.title || "document").replace(/\s+/g, "-").toLowerCase()}.html`;
    link.click();
    URL.revokeObjectURL(url);
    eventBus?.emit("document.export.succeeded", { format: "html" });
  }

  return {
    exportHtml,
  };
}
