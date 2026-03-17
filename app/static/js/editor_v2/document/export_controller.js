export function createExportController({ workspaceState, quillAdapter, eventBus }) {
  function exportHtml() {
    const state = workspaceState.getState();
    if (!state.active_document || state.save_status === "error") {
      eventBus?.emit("document.export.failed", { message: "This document cannot be exported right now." });
      return;
    }
    const blob = new Blob([quillAdapter.getHTML()], { type: "text/html;charset=utf-8" });
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
