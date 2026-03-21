import test from "node:test";
import assert from "node:assert/strict";

import { createCitationsListView } from "../extension/sidepanel/components/citations_list_view.js";
import { createNotesListView } from "../extension/sidepanel/components/notes_list_view.js";
import { renderCitationModal } from "../extension/sidepanel/app/citation_modal.js";

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key || "";
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
    this.shiftKey = Boolean(init.shiftKey);
    this.defaultPrevented = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const handler of list) {
      handler(event);
    }
    return !event.defaultPrevented;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.textContent = "";
    this.value = "";
    this._innerHTML = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  click() {
    this.dispatchEvent(new FakeEvent("click"));
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function findByAttr(node, name, value) {
  if (!node) {
    return null;
  }
  if (typeof node.getAttribute === "function" && node.getAttribute(name) === value) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findByAttr(child, name, value);
    if (match) {
      return match;
    }
  }
  if (node.shadowRoot) {
    const match = findByAttr(node.shadowRoot, name, value);
    if (match) {
      return match;
    }
  }
  return null;
}

function collectText(node) {
  if (!node) {
    return "";
  }
  const pieces = [];
  if (typeof node.textContent === "string" && node.textContent.trim()) {
    pieces.push(node.textContent.trim());
  }
  for (const child of node.children || []) {
    const text = collectText(child);
    if (text) {
      pieces.push(text);
    }
  }
  if (node.shadowRoot) {
    const text = collectText(node.shadowRoot);
    if (text) {
      pieces.push(text);
    }
  }
  return pieces.join(" ");
}

test("hover previews render for citations and notes", () => {
  const documentRef = new FakeDocument();

  const citationsView = createCitationsListView({
    documentRef,
    citations: [
      {
        id: "citation-1",
        source: { title: "Research article", hostname: "example.com" },
        style: "apa",
        format: "bibliography",
        excerpt: "A compact citation excerpt.",
        created_at: "2026-03-21",
      },
    ],
  });

  const citationRow = findByAttr(citationsView.root, "data-citation-id", "citation-1");
  assert.ok(citationRow);
  citationRow.dispatchEvent(new FakeEvent("mouseenter"));
  const citationPreview = findByAttr(citationsView.root, "data-hover-preview", "true");
  assert.match(collectText(citationPreview), /Citation preview/i);
  assert.match(collectText(citationPreview), /Research article|A compact citation excerpt/i);

  const notesView = createNotesListView({
    documentRef,
    notes: [
      {
        id: "note-1",
        title: "Reading note",
        note_body: "A short note body for hover preview.",
      },
    ],
  });

  const noteRow = findByAttr(notesView.root, "data-note-id", "note-1");
  assert.ok(noteRow);
  noteRow.dispatchEvent(new FakeEvent("mouseenter"));
  const notePreview = findByAttr(notesView.root, "data-hover-preview", "true");
  assert.match(collectText(notePreview), /Note preview/i);
  assert.match(collectText(notePreview), /Reading note|A short note body/i);
});

test("citation modal keyboard shortcuts trigger copy, save, and dismiss", async () => {
  const documentRef = new FakeDocument();
  const clipboardWrites = [];
  let dismissCount = 0;
  const saveCalls = [];

  const modal = renderCitationModal(documentRef.body, {
    citation: {
      id: "citation-1",
      metadata: { title: "Backend title" },
      style: "apa",
      format: "bibliography",
      full_citation: "Backend full citation",
    },
    render_bundle: {
      renders: {
        apa: {
          bibliography: "Backend full citation",
        },
      },
    },
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: [],
    loading: false,
    error: null,
  }, {
    documentRef,
    navigatorRef: {
      clipboard: {
        async writeText(text) {
          clipboardWrites.push(text);
        },
      },
    },
    onSave: async (payload) => {
      saveCalls.push(payload);
    },
    onDismiss: () => {
      dismissCount += 1;
    },
  });

  const wrapper = modal.root.children[0];
  assert.ok(wrapper);

  wrapper.dispatchEvent(new FakeEvent("keydown", { key: "Enter", ctrlKey: true }));
  await Promise.resolve();
  assert.equal(clipboardWrites.at(-1), "Backend full citation");
  assert.equal(saveCalls.at(-1)?.copy, true);

  wrapper.dispatchEvent(new FakeEvent("keydown", { key: "s", ctrlKey: true }));
  await Promise.resolve();
  assert.equal(saveCalls.length >= 2, true);

  wrapper.dispatchEvent(new FakeEvent("keydown", { key: "Escape" }));
  assert.equal(dismissCount, 1);
});
