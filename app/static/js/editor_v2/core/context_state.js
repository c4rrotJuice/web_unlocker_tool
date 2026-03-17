export function deriveContextState(workspace, selection) {
  const seed = workspace.seed_state;
  const focused = workspace.focused_entity;
  const document = workspace.active_document;
  const selectionText = (selection.text || "").trim();

  if (!document) {
    return { mode: "empty_document", entity: null };
  }
  if (focused?.type === "citation") {
    return { mode: "citation_focus", entity: focused };
  }
  if (focused?.type === "quote") {
    return { mode: "quote_focus", entity: focused };
  }
  if (focused?.type === "note") {
    return { mode: "note_focus", entity: focused };
  }
  if (focused?.type === "source") {
    return { mode: "source_focus", entity: focused };
  }
  if (seed?.citation_id && (seed.mode === "seed_review" || seed.mode === "quote_focus")) {
    return { mode: seed.mode || "seed_review", entity: seed };
  }
  if (selectionText) {
    return { mode: "text_selection", entity: null };
  }
  const ops = document.content_delta?.ops || [];
  const plainText = ops.map((op) => typeof op.insert === "string" ? op.insert : "").join("").trim();
  if (!plainText) {
    return { mode: "empty_document", entity: null };
  }
  return { mode: "idle", entity: null };
}
