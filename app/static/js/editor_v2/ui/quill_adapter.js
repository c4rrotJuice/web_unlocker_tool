let registered = false;
const FONT_FAMILIES = [
  "Georgia,serif",
  "Cambria,serif",
  "\"Times New Roman\",serif",
  "\"Palatino Linotype\",\"Book Antiqua\",Palatino,serif",
  "Garamond,serif",
  "Baskerville,serif",
  "\"Century Schoolbook\",\"Times New Roman\",serif",
  "Didot,\"Bodoni MT\",\"Times New Roman\",serif",
];
const FONT_SIZES = ["12px", "13px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];

const GRAMMARLY_STRIP_PATTERNS = [
  /<grammarly-desktop-integration\b[^>]*>.*?<\/grammarly-desktop-integration>/gis,
  /\sdata-gramm(?:="[^"]*")?/gi,
  /\sdata-gr-(?:ext-installed|id|editor-state|focused|saved|ghost|check-loaded|loaded)="[^"]*"/gi,
];

function stripGrammarMarkers(html) {
  let next = html || "";
  for (const pattern of GRAMMARLY_STRIP_PATTERNS) {
    next = next.replace(pattern, "");
  }
  return next;
}

export function composeEditorDelta(currentDelta, changeDelta) {
  if (typeof window === "undefined" || !window.Quill || typeof window.Quill.import !== "function") {
    return currentDelta || { ops: [{ insert: "\n" }] };
  }
  const Delta = window.Quill.import("delta");
  if (typeof Delta !== "function") {
    return currentDelta || { ops: [{ insert: "\n" }] };
  }
  const base = new Delta(currentDelta || { ops: [{ insert: "\n" }] });
  const change = new Delta(changeDelta || { ops: [] });
  const composed = base.compose(change);
  return { ops: Array.isArray(composed.ops) ? composed.ops.slice() : [] };
}

export function sanitizeEditorHtml(html) {
  if (!html) return "";
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return stripGrammarMarkers(html);
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content || template;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const removals = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const tagName = String(node.tagName || "").toLowerCase();
    if (tagName === "grammarly-desktop-integration") {
      removals.push(node);
      continue;
    }
    const attributes = Array.from(node.attributes || []);
    for (const attribute of attributes) {
      const name = attribute.name.toLowerCase();
      if (name === "data-gramm" || name.startsWith("data-gr-")) {
        node.removeAttribute(attribute.name);
      }
    }
    const classes = Array.from(node.classList || []);
    if (classes.some((className) => /grammarly/i.test(className))) {
      for (const className of classes) {
        if (/grammarly/i.test(className)) {
          node.classList.remove(className);
        }
      }
    }
  }

  for (const node of removals) {
    node.remove();
  }

  return template.innerHTML;
}

function registerEditorFormats(Quill) {
  if (registered) return;
  registered = true;
  const SizeStyle = Quill.import("attributors/style/size");
  const FontStyle = Quill.import("attributors/style/font");
  const AlignStyle = Quill.import("attributors/style/align");
  const Inline = Quill.import("blots/inline");
  const BlockEmbed = Quill.import("blots/block/embed");

  SizeStyle.whitelist = FONT_SIZES;
  FontStyle.whitelist = FONT_FAMILIES;
  AlignStyle.whitelist = ["center", "right", "justify"];

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

  Quill.register(SizeStyle, true);
  Quill.register(FontStyle, true);
  Quill.register(AlignStyle, true);
  Quill.register(CitationChipBlot, true);
  Quill.register(NoteMarkerBlot, true);
  Quill.register(QuoteBlockBlot, true);
}

export function createQuillAdapter({ element, toolbarSelector, onTextChange, onSelectionChange }) {
  const { Quill } = window;
  registerEditorFormats(Quill);
  element.setAttribute("data-gramm", "false");
  element.setAttribute("spellcheck", "false");
  element.setAttribute("autocapitalize", "off");
  element.setAttribute("autocomplete", "off");
  element.setAttribute("autocorrect", "off");
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
      return sanitizeEditorHtml(quill.root.innerHTML);
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
