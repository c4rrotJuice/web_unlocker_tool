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

test("plain note flow in sidepanel saves through background with active-tab page context", async () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("main");
  const calls = [];
  const chromeApi = {
    tabs: {
      async query() {
        return [{ title: "Example article", url: "https://example.com/article" }];
      },
    },
  };
  const runtimeClient = {
    async bootstrapFetch() {
      return { ok: true, data: { auth: { status: "signed_in", bootstrap: { profile: { display_name: "Researcher" } } } } };
    },
    async authStatusGet() {
      return { ok: true, data: { auth: { status: "signed_in", bootstrap: { profile: { display_name: "Researcher" } } } } };
    },
    async authStart() {
      return { ok: true, data: { auth: { status: "signed_in" } } };
    },
    async authLogout() {
      return { ok: true, data: { auth: { status: "signed_out" } } };
    },
    async createNote(payload) {
      calls.push(payload);
      return { ok: true, data: { id: "note-1" } };
    },
  };

  renderSidepanel(root, {
    documentRef,
    chromeApi,
    runtimeClient,
    setTimeoutRef(callback) {
      callback();
      return 1;
    },
    clearTimeoutRef() {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const newNoteTab = findByAttr(root, "data-tab", "new-note");
  newNoteTab.dispatchEvent(new FakeEvent("click", newNoteTab));
  const openButton = findByAttr(root, "data-note-open", "true");
  openButton.dispatchEvent(new FakeEvent("click", openButton));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const noteInput = findByAttr(root, "data-note-text", "true");
  noteInput.value = "Plain note from sidepanel";
  noteInput.dispatchEvent(new FakeEvent("input", noteInput));
  const saveButton = findByAttr(root, "data-note-save", "true");
  saveButton.dispatchEvent(new FakeEvent("click", saveButton));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].noteText, "Plain note from sidepanel");
  assert.equal(calls[0].capture.pageTitle, "Example article");
  assert.equal(calls[0].capture.pageUrl, "https://example.com/article");
  assert.equal(calls[0].capture.pageDomain, "example.com");
});

test("sidepanel note failures keep the typed text available for retry", async () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("main");
  const runtimeClient = {
    async bootstrapFetch() {
      return { ok: true, data: { auth: { status: "signed_in", bootstrap: { profile: { display_name: "Researcher" } } } } };
    },
    async authStatusGet() {
      return { ok: true, data: { auth: { status: "signed_in", bootstrap: { profile: { display_name: "Researcher" } } } } };
    },
    async authStart() {
      return { ok: true, data: { auth: { status: "signed_in" } } };
    },
    async authLogout() {
      return { ok: true, data: { auth: { status: "signed_out" } } };
    },
    async createNote() {
      return { ok: false, error: { code: "network_error", message: "Note save failed." } };
    },
  };

  const view = renderSidepanel(root, {
    documentRef,
    chromeApi: {
      tabs: {
        async query() {
          return [];
        },
      },
    },
    runtimeClient,
    setTimeoutRef() {
      return 1;
    },
    clearTimeoutRef() {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const newNoteTab = findByAttr(root, "data-tab", "new-note");
  newNoteTab.dispatchEvent(new FakeEvent("click", newNoteTab));
  const openButton = findByAttr(root, "data-note-open", "true");
  openButton.dispatchEvent(new FakeEvent("click", openButton));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const noteInput = findByAttr(root, "data-note-text", "true");
  noteInput.value = "Retry me";
  noteInput.dispatchEvent(new FakeEvent("input", noteInput));
  const saveButton = findByAttr(root, "data-note-save", "true");
  saveButton.dispatchEvent(new FakeEvent("click", saveButton));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(view.getState().noteStatus, "error");
  assert.equal(view.getState().noteText, "Retry me");
  assert.equal(view.getState().noteError, "Note save failed.");
});
