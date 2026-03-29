import test from "node:test";
import assert from "node:assert/strict";

import { renderSidepanel } from "../extension/sidepanel/main.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.key = init.key || "";
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
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
    this.disabled = false;
    this._innerHTML = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  focus() {}

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
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
  return null;
}

function collectText(node) {
  if (!node) {
    return "";
  }
  return [node.textContent || "", ...(node.children || []).map((child) => collectText(child))].join(" ").replace(/\s+/g, " ").trim();
}

async function nextTick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createSignedInAuth() {
  return { status: "signed_in", bootstrap: { profile: { display_name: "Researcher" } } };
}

function createNote(id, title = "Draft note", body = "Original body") {
  return {
    id,
    title,
    note_body: body,
    highlight_text: null,
    page_url: "https://example.com/article",
    created_at: "2026-03-20T10:00:00Z",
    updated_at: "2026-03-20T10:00:00Z",
    source: { url: "https://example.com/article" },
  };
}

async function setupNotesView({ notes = [createNote("note-1")], updateNote = async () => ({ ok: true, data: { note: notes[0] } }), clipboard = [] } = {}) {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("main");
  const runtimeClient = {
    async bootstrapFetch() {
      return { ok: true, data: { auth: createSignedInAuth() } };
    },
    async authStatusGet() {
      return { ok: true, data: { auth: createSignedInAuth() } };
    },
    async authStart() {
      return { ok: true, data: { auth: createSignedInAuth() } };
    },
    async authLogout() {
      return { ok: true, data: { auth: { status: "signed_out" } } };
    },
    async listRecentCitations() {
      return { ok: true, data: { items: [] } };
    },
    async listRecentNotes() {
      return { ok: true, data: { items: notes } };
    },
    async updateNote(payload) {
      return updateNote(payload);
    },
  };

  const view = renderSidepanel(root, {
    documentRef,
    chromeApi: {
      storage: {
        onChanged: {
          addListener() {},
          removeListener() {},
        },
      },
    },
    navigatorRef: {
      clipboard: {
        async writeText(text) {
          clipboard.push(text);
        },
      },
    },
    runtimeClient,
  });

  await view.refresh();
  await nextTick();

  const notesTab = findByAttr(root, "data-tab", "notes");
  notesTab.dispatchEvent(new FakeEvent("click", notesTab));
  await nextTick();

  return {
    root,
    view,
    clipboard,
    getNoteRow(noteId = "note-1") {
      return findByAttr(root, "data-note-id", noteId);
    },
    getPreview() {
      return findByAttr(root, "data-hover-preview-pane", "true");
    },
  };
}

test("hover preview opens for a note", async () => {
  const screen = await setupNotesView();
  const row = screen.getNoteRow();
  row.dispatchEvent(new FakeEvent("mouseenter", row));

  const preview = screen.getPreview();
  assert.equal(preview.style.display, "block");
  assert.match(collectText(preview), /Draft note/);
  assert.ok(findByAttr(preview, "data-note-preview-copy", "true"));
  assert.ok(findByAttr(preview, "data-note-preview-edit", "true"));
});

test("edit mode enters correctly and applies inline editors", async () => {
  const screen = await setupNotesView();
  const row = screen.getNoteRow();
  row.dispatchEvent(new FakeEvent("mouseenter", row));

  const preview = screen.getPreview();
  const editButton = findByAttr(preview, "data-note-preview-edit", "true");
  editButton.dispatchEvent(new FakeEvent("click", editButton));

  assert.ok(findByAttr(preview, "data-note-preview-title-input", "true"));
  assert.ok(findByAttr(preview, "data-note-preview-body-input", "true"));
  assert.ok(findByAttr(preview, "data-note-preview-save", "true"));
  assert.ok(findByAttr(preview, "data-note-preview-cancel", "true"));
  assert.match(String(preview.style.background || ""), /6, 78, 59|linear-gradient/i);
});

test("save persists through background and refreshes preview plus list", async () => {
  const updatedNote = createNote("note-1", "Edited title", "Edited body");
  const updateCalls = [];
  const screen = await setupNotesView({
    updateNote: async (payload) => {
      updateCalls.push(payload);
      return { ok: true, data: { note: updatedNote } };
    },
  });

  const row = screen.getNoteRow();
  row.dispatchEvent(new FakeEvent("mouseenter", row));

  const preview = screen.getPreview();
  findByAttr(preview, "data-note-preview-edit", "true").dispatchEvent(new FakeEvent("click", preview));

  const titleInput = findByAttr(preview, "data-note-preview-title-input", "true");
  const bodyInput = findByAttr(preview, "data-note-preview-body-input", "true");
  titleInput.value = "Edited title";
  titleInput.dispatchEvent(new FakeEvent("input", titleInput));
  bodyInput.value = "Edited body";
  bodyInput.dispatchEvent(new FakeEvent("input", bodyInput));

  const saveButton = findByAttr(preview, "data-note-preview-save", "true");
  saveButton.dispatchEvent(new FakeEvent("click", saveButton));
  await nextTick();

  assert.deepEqual(updateCalls, [{
    noteId: "note-1",
    title: "Edited title",
    note_body: "Edited body",
  }]);
  assert.match(collectText(screen.getNoteRow()), /Edited title/);
  assert.match(collectText(preview), /Edited title/);
  assert.match(collectText(preview), /Edited body/);
});

test("cancel discards unsaved local changes", async () => {
  const screen = await setupNotesView();
  const row = screen.getNoteRow();
  row.dispatchEvent(new FakeEvent("mouseenter", row));

  const preview = screen.getPreview();
  findByAttr(preview, "data-note-preview-edit", "true").dispatchEvent(new FakeEvent("click", preview));

  const titleInput = findByAttr(preview, "data-note-preview-title-input", "true");
  const bodyInput = findByAttr(preview, "data-note-preview-body-input", "true");
  titleInput.value = "Changed title";
  titleInput.dispatchEvent(new FakeEvent("input", titleInput));
  bodyInput.value = "Changed body";
  bodyInput.dispatchEvent(new FakeEvent("input", bodyInput));

  const cancelButton = findByAttr(preview, "data-note-preview-cancel", "true");
  cancelButton.dispatchEvent(new FakeEvent("click", cancelButton));

  assert.match(collectText(preview), /Draft note/);
  assert.match(collectText(preview), /Original body/);
  assert.match(collectText(screen.getNoteRow()), /Draft note/);
  assert.doesNotMatch(collectText(preview), /Changed title/);
});

test("copy works from preview in read and edit contexts", async () => {
  const clipboard = [];
  const screen = await setupNotesView({ clipboard });
  const row = screen.getNoteRow();
  row.dispatchEvent(new FakeEvent("mouseenter", row));

  const preview = screen.getPreview();
  const copyButton = findByAttr(preview, "data-note-preview-copy", "true");
  copyButton.dispatchEvent(new FakeEvent("click", copyButton));
  await nextTick();

  findByAttr(preview, "data-note-preview-edit", "true").dispatchEvent(new FakeEvent("click", preview));
  const titleInput = findByAttr(preview, "data-note-preview-title-input", "true");
  const bodyInput = findByAttr(preview, "data-note-preview-body-input", "true");
  titleInput.value = "Copied title";
  titleInput.dispatchEvent(new FakeEvent("input", titleInput));
  bodyInput.value = "Copied body";
  bodyInput.dispatchEvent(new FakeEvent("input", bodyInput));

  findByAttr(preview, "data-note-preview-copy", "true").dispatchEvent(new FakeEvent("click", preview));
  await nextTick();

  assert.deepEqual(clipboard, [
    "Draft note\n\nOriginal body",
    "Copied title\n\nCopied body",
  ]);
});
