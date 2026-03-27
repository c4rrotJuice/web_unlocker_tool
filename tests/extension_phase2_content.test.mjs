import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createPageUnlockEngine } from "../extension/content/unlock/engine.js";
import { bootstrapContent, shouldBootstrapContentRuntime } from "../extension/content/index.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.currentTarget = null;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
    this.key = init.key || "";
    this.clientX = init.clientX;
    this.clientY = init.clientY;
    this._path = init.path || null;
  }

  composedPath() {
    if (Array.isArray(this._path)) {
      return this._path;
    }
    const path = [];
    let node = this.target;
    while (node) {
      path.push(node);
      node = node.parentNode || null;
    }
    return path;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }

  stopImmediatePropagation() {
    this.immediatePropagationStopped = true;
    this.propagationStopped = true;
  }
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler, options = false) {
    const list = this.listeners.get(type) || [];
    list.push({ handler, capture: options === true || Boolean(options?.capture) });
    this.listeners.set(type, list);
  }

  removeEventListener(type, handler, options = false) {
    const capture = options === true || Boolean(options?.capture);
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((entry) => entry.handler !== handler || entry.capture !== capture),
    );
  }

  dispatchEvent(event) {
    const list = [...(this.listeners.get(event.type) || [])];
    for (const entry of list) {
      event.currentTarget = this;
      entry.handler(event);
      if (event.immediatePropagationStopped) {
        break;
      }
    }
    return !event.defaultPrevented;
  }
}

class FakeStyle {
  constructor() {
    this.position = "";
    this.opacity = "";
    this.backgroundColor = "";
    this.zIndex = "";
    this.pointerEvents = "";
    this.visibility = "";
    this.display = "";
  }

  setProperty(name, value) {
    this[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
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
    this.className = "";
    this.id = "";
    this.style = new FakeStyle();
    this.textContent = "";
    this.isContentEditable = false;
    this.contentEditable = "";
    this.open = false;
    this.onclick = null;
    this.onmousedown = null;
    this.oncopy = null;
    this.oncut = null;
    this.onpaste = null;
    this.oncontextmenu = null;
    this.onselectstart = null;
    this.ondragstart = null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === "id") {
      this.id = normalized;
    }
    if (name === "class") {
      this.className = normalized;
    }
    if (name === "contenteditable") {
      this.contentEditable = normalized;
      this.isContentEditable = normalized === "" || normalized === "true" || normalized === "plaintext-only";
    }
  }

  getAttribute(name) {
    if (name === "id") {
      return this.id || null;
    }
    if (name === "class") {
      return this.className || null;
    }
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "id") {
      this.id = "";
    }
    if (name === "class") {
      this.className = "";
    }
    if (name === "contenteditable") {
      this.contentEditable = "";
      this.isContentEditable = false;
    }
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this._pointElements = [];
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this.walk().find((node) => node.id === id) || null;
  }

  walk(root = this.documentElement) {
    const nodes = [root];
    for (const child of root.children) {
      nodes.push(...this.walk(child));
    }
    return nodes;
  }

  elementsFromPoint() {
    return this._pointElements;
  }
}

class FakeWindow extends FakeEventTarget {
  constructor(documentRef) {
    super();
    this.document = documentRef;
    this.location = { href: "https://example.com/article" };
    this.history = {
      pushState: (...args) => {
        const nextUrl = args[2];
        if (nextUrl) {
          this.location.href = String(nextUrl);
        }
      },
      replaceState: (...args) => {
        const nextUrl = args[2];
        if (nextUrl) {
          this.location.href = String(nextUrl);
        }
      },
    };
  }

  getComputedStyle(element) {
    return element.style;
  }
}

class FakeMutationObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observeCalls = [];
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }

  observe(target, options) {
    this.observeCalls.push({ target, options });
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger(records) {
    this.callback(records, this);
  }
}

function installEnvironment() {
  const documentRef = new FakeDocument();
  const windowRef = new FakeWindow(documentRef);
  return { documentRef, windowRef };
}

test("content runtime ships autonomous unlock bootstrap without background coupling", () => {
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
  const source = fs.readFileSync("extension/content/index.ts", "utf8");
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
  assert.match(source, /createPageUnlockEngine/);
  assert.equal(source.includes("runtime.sendMessage"), false);
  assert.equal(source.includes("fetch("), false);
});

test("bootstrap is idempotent and injects one style tag plus one listener set", () => {
  const { documentRef, windowRef } = installEnvironment();
  const runtimeA = bootstrapContent({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });
  const runtimeB = bootstrapContent({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });

  assert.equal(runtimeA, runtimeB);
  assert.equal(documentRef.walk().filter((node) => node.id === "writior-copy-unlock-style").length, 1);
  assert.equal(runtimeA.getState().bootstrapCount, 1);
  assert.equal(runtimeA.getState().mode, "balanced");
  assert.equal(runtimeA.getState().guardInstallCount, 1);
  assert.equal(documentRef.listeners.get("copy").length, 1);
  assert.equal(documentRef.listeners.get("contextmenu").length, 1);
  assert.equal(documentRef.listeners.get("mouseup").length, 2);
  assert.equal(documentRef.listeners.get("keyup").length, 2);
});

test("content runtime skips the first-party editor route", () => {
  const { documentRef, windowRef } = installEnvironment();
  windowRef.location.href = "https://app.writior.com/editor?document_id=doc-1";

  const runtime = bootstrapContent({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });

  assert.equal(runtime, null);
  assert.equal(documentRef.getElementById("writior-copy-unlock-style"), null);
  assert.equal(documentRef.listeners.get("mousedown"), undefined);
  assert.equal(documentRef.listeners.get("click"), undefined);
});

test("content runtime url guard only excludes first-party editor routes", () => {
  assert.equal(shouldBootstrapContentRuntime("https://app.writior.com/editor"), false);
  assert.equal(shouldBootstrapContentRuntime("https://app.writior.com/editor/live"), false);
  assert.equal(shouldBootstrapContentRuntime("http://localhost:8000/editor"), false);
  assert.equal(shouldBootstrapContentRuntime("https://example.com/editor"), true);
  assert.equal(shouldBootstrapContentRuntime("https://app.writior.com/research"), true);
  assert.equal(shouldBootstrapContentRuntime("not a url"), true);
});

test("target classification stays conservative for safe content, inputs, and editors", () => {
  const { documentRef, windowRef } = installEnvironment();
  const engine = createPageUnlockEngine({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });

  const paragraph = documentRef.createElement("p");
  const input = documentRef.createElement("input");
  const editor = documentRef.createElement("div");
  editor.setAttribute("class", "ProseMirror editor-root");
  const contentEditable = documentRef.createElement("div");
  contentEditable.setAttribute("contenteditable", "true");

  assert.equal(engine.classifyTarget(paragraph).kind, "safe-content");
  assert.equal(engine.classifyTarget(input).kind, "form-control");
  assert.equal(engine.classifyTarget(editor).kind, "editor");
  assert.equal(engine.classifyTarget(contentEditable).kind, "contenteditable");
});

test("capture guards restore copy, contextmenu, and shortcuts for safe content, inputs, and contenteditable", () => {
  const { documentRef, windowRef } = installEnvironment();
  const engine = createPageUnlockEngine({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });
  engine.bootstrap();

  const article = documentRef.createElement("div");
  const input = documentRef.createElement("input");
  const editor = documentRef.createElement("div");
  editor.setAttribute("contenteditable", "true");
  documentRef.body.appendChild(article);
  documentRef.body.appendChild(input);
  documentRef.body.appendChild(editor);

  const articleCopy = new FakeEvent("copy", article);
  const inputPaste = new FakeEvent("paste", input);
  const articleContext = new FakeEvent("contextmenu", article);
  const editorCopy = new FakeEvent("copy", editor);
  const editorPaste = new FakeEvent("paste", editor);
  const inputShortcut = new FakeEvent("keydown", input, { ctrlKey: true, key: "v" });
  const editorShortcut = new FakeEvent("keydown", editor, { ctrlKey: true, key: "v" });

  documentRef.dispatchEvent(articleCopy);
  documentRef.dispatchEvent(inputPaste);
  documentRef.dispatchEvent(articleContext);
  documentRef.dispatchEvent(editorCopy);
  documentRef.dispatchEvent(editorPaste);
  documentRef.dispatchEvent(inputShortcut);
  documentRef.dispatchEvent(editorShortcut);

  assert.equal(articleCopy.immediatePropagationStopped, true);
  assert.equal(inputPaste.immediatePropagationStopped, false);
  assert.equal(articleContext.immediatePropagationStopped, true);
  assert.equal(editorCopy.immediatePropagationStopped, false);
  assert.equal(editorPaste.immediatePropagationStopped, false);
  assert.equal(inputShortcut.immediatePropagationStopped, false);
  assert.equal(editorShortcut.immediatePropagationStopped, false);
});

test("mutation batching deduplicates repeated nodes before autonomous inline cleanup", async () => {
  const { documentRef, windowRef } = installEnvironment();
  const queuedCallbacks = [];
  const engine = createPageUnlockEngine({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    queueMicrotaskRef(callback) {
      queuedCallbacks.push(callback);
    },
  });
  engine.bootstrap();

  const target = documentRef.createElement("div");
  target.oncopy = () => false;
  target.setAttribute("oncontextmenu", "return false");
  target.style.userSelect = "none";
  documentRef.body.appendChild(target);

  const observer = FakeMutationObserver.instances.at(-1);
  observer.trigger([
    { target, addedNodes: [target] },
    { target, addedNodes: [] },
  ]);

  assert.equal(queuedCallbacks.length, 1);
  queuedCallbacks.shift()();

  assert.equal(target.oncopy, null);
  assert.equal(target.getAttribute("oncontextmenu"), null);
  assert.equal(target.style.userSelect, "text");
  assert.equal(engine.getState().mutationBatchCount, 1);
  assert.equal(engine.getState().inlineCleanupCount, 2);
  assert.equal(engine.getState().styleRecoveryCount, 1);
});

test("mutation cleanup skips editable subtrees and does not rewrite their handlers or styles", async () => {
  const { documentRef, windowRef } = installEnvironment();
  const queuedCallbacks = [];
  const engine = createPageUnlockEngine({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    queueMicrotaskRef(callback) {
      queuedCallbacks.push(callback);
    },
  });
  engine.bootstrap();

  const editor = documentRef.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.onpaste = () => false;
  editor.style.userSelect = "none";
  const inner = documentRef.createElement("span");
  editor.appendChild(inner);
  documentRef.body.appendChild(editor);

  const observer = FakeMutationObserver.instances.at(-1);
  observer.trigger([{ target: editor, addedNodes: [editor] }]);
  queuedCallbacks.shift()();

  assert.equal(editor.onpaste !== null, true);
  assert.equal(editor.style.userSelect, "none");
  assert.equal(engine.getState().styleRecoveryCount, 0);
});

test("overlay mitigation is event-triggered and conservative", () => {
  const { documentRef, windowRef } = installEnvironment();
  const engine = createPageUnlockEngine({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });
  engine.bootstrap();

  const overlay = documentRef.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.opacity = "0";
  overlay.style.backgroundColor = "transparent";
  overlay.style.zIndex = "999";
  const article = documentRef.createElement("article");
  documentRef._pointElements = [overlay, article];

  const event = new FakeEvent("contextmenu", overlay, { clientX: 10, clientY: 12 });
  documentRef.dispatchEvent(event);

  assert.equal(overlay.style.pointerEvents, "none");
  assert.equal(engine.getState().overlayMitigationCount, 1);
});

test("root blocker cleanup clears document-level DOM0 handlers and route changes reprocess content", () => {
  const { documentRef, windowRef } = installEnvironment();
  documentRef.oncopy = () => false;
  documentRef.body.oncontextmenu = () => false;
  documentRef.documentElement.onselectstart = () => false;

  const engine = createPageUnlockEngine({ documentRef, windowRef, MutationObserverRef: FakeMutationObserver });
  engine.bootstrap();

  assert.equal(documentRef.oncopy, null);
  assert.equal(documentRef.body.oncontextmenu, null);
  assert.equal(documentRef.documentElement.onselectstart, null);

  const nextNode = documentRef.createElement("div");
  nextNode.oncopy = () => false;
  documentRef.body.appendChild(nextNode);
  windowRef.history.pushState({}, "", "https://example.com/next");
  engine.flushMutationBatch();

  assert.equal(engine.getState().routeChangeCount, 1);
  assert.equal(nextNode.oncopy, null);
});
