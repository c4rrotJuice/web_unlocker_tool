export function getFocusedInlineEntity(quill, range) {
  if (!range) return null;
  const [leaf] = quill.getLeaf(range.index);
  const domNode = leaf?.domNode;
  if (!domNode?.dataset) return null;
  if (domNode.dataset.citationId) {
    return { type: "citation", id: domNode.dataset.citationId };
  }
  if (domNode.dataset.noteId) {
    return { type: "note", id: domNode.dataset.noteId };
  }
  if (domNode.dataset.quoteId) {
    return { type: "quote", id: domNode.dataset.quoteId };
  }
  return null;
}
