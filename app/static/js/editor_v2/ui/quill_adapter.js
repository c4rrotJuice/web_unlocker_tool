let registered = false;

function registerEditorFormats(Quill) {
  if (registered) return;
  registered = true;
  const Inline = Quill.import("blots/inline");
  const BlockEmbed = Quill.import("blots/block/embed");

  class CitationChipBlot extends Inline {
    static create(value) {
      const node = super.create();
      node.dataset.citationId = value.citationId;
      node.dataset.sourceId = value.sourceId || "";
      node.tabIndex = 0;
      node.className = "editor-v2-chip";
      node.textContent = value.label || "Citation";
      return node;
    }

    static value(node) {
      return {
        citationId: node.dataset.citationId,
        sourceId: node.dataset.sourceId || null,
        label: node.textContent || "",
      };
    }
  }
  CitationChipBlot.blotName = "citation-chip";
  CitationChipBlot.tagName = "span";

  class NoteMarkerBlot extends Inline {
    static create(value) {
      const node = super.create();
      node.dataset.noteId = value.noteId;
      node.tabIndex = 0;
      node.className = "editor-v2-chip-note";
      node.textContent = value.label || "Note";
      return node;
    }

    static value(node) {
      return {
        noteId: node.dataset.noteId,
        label: node.textContent || "",
      };
    }
  }
  NoteMarkerBlot.blotName = "note-marker";
  NoteMarkerBlot.tagName = "span";

  class QuoteBlockBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.dataset.quoteId = value.quoteId || "";
      node.dataset.citationId = value.citationId || "";
      node.tabIndex = 0;
      node.className = "editor-v2-card";
      node.textContent = value.text || "";
      return node;
    }

    static value(node) {
      return {
        quoteId: node.dataset.quoteId || null,
        citationId: node.dataset.citationId || null,
        text: node.textContent || "",
      };
    }
  }
  QuoteBlockBlot.blotName = "quote-block";
  QuoteBlockBlot.tagName = "blockquote";

  Quill.register(CitationChipBlot, true);
  Quill.register(NoteMarkerBlot, true);
  Quill.register(QuoteBlockBlot, true);
}

export function createQuillAdapter({ element, toolbarSelector, onTextChange, onSelectionChange }) {
  const { Quill } = window;
  registerEditorFormats(Quill);
  const quill = new Quill(element, {
    modules: { toolbar: toolbarSelector },
    theme: "snow",
    placeholder: "Build from your research without losing the thread.",
  });
  quill.on("text-change", (delta, oldDelta, source) => onTextChange?.({ delta, oldDelta, source }));
  quill.on("selection-change", (range, oldRange, source) => onSelectionChange?.({ range, oldRange, source }));

  return {
    quill,
    root: quill.root,
    setContents(delta) {
      quill.setContents(delta || { ops: [{ insert: "\n" }] }, "silent");
    },
    getContents() {
      return quill.getContents();
    },
    getHTML() {
      return quill.root.innerHTML;
    },
    getText(range = null) {
      if (range) return quill.getText(range.index, range.length);
      return quill.getText();
    },
    getSelection() {
      return quill.getSelection();
    },
    focus() {
      quill.focus();
    },
    setSelection(index, length = 0, source = "silent") {
      quill.setSelection(index, length, source);
    },
    insertCitationChip({ citationId, sourceId, label, index }) {
      quill.insertEmbed(index, "citation-chip", { citationId, sourceId, label }, "user");
      quill.insertText(index + 1, " ", "user");
      quill.setSelection(index + 2, 0, "silent");
    },
    insertNoteMarker({ noteId, label, index }) {
      quill.insertEmbed(index, "note-marker", { noteId, label }, "user");
      quill.insertText(index + 1, " ", "user");
      quill.setSelection(index + 2, 0, "silent");
    },
    insertQuoteBlock({ quoteId, citationId, text, index }) {
      quill.insertEmbed(index, "quote-block", { quoteId, citationId, text }, "user");
      quill.insertText(index + 1, "\n", "user");
      quill.setSelection(index + 2, 0, "silent");
    },
    insertText(index, text) {
      quill.insertText(index, text, "user");
      quill.setSelection(index + text.length, 0, "silent");
    },
  };
}
