import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createPageUnlockEngine } from "../extension/content/page/unlock_engine.js";
import { probePageContext } from "../extension/content/dom/context_probe.js";
import { createContentRuntime } from "../extension/content/index.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
    this.key = init.key || "";
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

  addEventListener(type, handler, options = {}) {
    const list = this.listeners.get(type) || [];
    list.push({ handler, capture: Boolean(options && options.capture) });
    this.listeners.set(type, list);
  }

  removeEventListener(type, handler, options = {}) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((entry) => entry.handler !== handler || entry.capture !== Boolean(options && options.capture)),
    );
  }

  dispatchEvent(event) {
    const list = this.listeners.get(event.type) || [];
    for (const entry of list) {
      if (event.immediatePropagationStopped) {
        break;
      }
      entry.handler(event);
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
    this.className = "";
    this.innerHTML = "";
    this.id = "";
    this.dataset = {};
    this.textContent = "";
    this.style = {};
    this.oncontextmenu = null;
    this.oncopy = null;
    this.contentEditable = "";
    this.isContentEditable = false;
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
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
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
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this._walk(this.documentElement).find((node) => node.id === id) || null;
  }

  _walk(root) {
    const nodes = [root];
    for (const child of root.children || []) {
      nodes.push(...this._walk(child));
    }
    return nodes;
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

  trigger(records = []) {
    this.callback(records, this);
  }
}

function createTimerHarness() {
  const timers = [];
  return {
    setTimeoutRef(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutRef() {},
    flush() {
      while (timers.length) {
        const timer = timers.shift();
        timer.callback();
      }
    },
    get pending() {
      return timers.length;
    },
  };
}

function installEnvironment() {
  const documentRef = new FakeDocument();
  const windowRef = new FakeEventTarget();
  windowRef.location = { href: "https://example.com/article" };
  windowRef.getComputedStyle = (node) => node.style || {};
  windowRef.setTimeout = globalThis.setTimeout;
  windowRef.clearTimeout = globalThis.clearTimeout;
  return { documentRef, windowRef };
}

function readSource(file) {
  return fs.readFileSync(path.join("extension", file), "utf8");
}

test("content runtime ships a browser-page utility engine and avoids backend calls", () => {
  const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
  const source = readSource("content/index.ts");
  assert.equal(Array.isArray(manifest.content_scripts), true);
  assert.equal(manifest.content_scripts[0].matches.includes("http://*/*"), true);
  assert.equal(manifest.content_scripts[0].matches.includes("https://*/*"), true);
  assert.match(source, /createPageUnlockEngine/);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("chrome.storage"), false);
});

test("blocked selection, copy, and right-click are restored without touching editable fields", () => {
  const { documentRef, windowRef } = installEnvironment();
  const timers = createTimerHarness();
  const engine = createPageUnlockEngine({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    setTimeoutRef: timers.setTimeoutRef,
    clearTimeoutRef: timers.clearTimeoutRef,
  });
  engine.bootstrap();

  const blockerCounts = { selectstart: 0, copy: 0, contextmenu: 0 };
  documentRef.addEventListener("selectstart", (event) => {
    blockerCounts.selectstart += 1;
    event.preventDefault();
  });
  documentRef.addEventListener("copy", (event) => {
    blockerCounts.copy += 1;
    event.preventDefault();
  });
  documentRef.addEventListener("contextmenu", (event) => {
    blockerCounts.contextmenu += 1;
    event.preventDefault();
  });

  const textTarget = documentRef.createElement("div");
  documentRef.body.appendChild(textTarget);

  const selectionEvent = new FakeEvent("selectstart", textTarget);
  const copyEvent = new FakeEvent("copy", textTarget);
  const contextEvent = new FakeEvent("contextmenu", textTarget);

  documentRef.dispatchEvent(selectionEvent);
  documentRef.dispatchEvent(copyEvent);
  documentRef.dispatchEvent(contextEvent);

  assert.equal(blockerCounts.selectstart, 0);
  assert.equal(blockerCounts.copy, 0);
  assert.equal(blockerCounts.contextmenu, 0);
  assert.equal(selectionEvent.defaultPrevented, false);
  assert.equal(copyEvent.defaultPrevented, false);
  assert.equal(contextEvent.defaultPrevented, false);
  assert.match(documentRef.getElementById("writior-content-unlock-style").textContent, /user-select: text/);

  const input = documentRef.createElement("input");
  documentRef.body.appendChild(input);
  documentRef.activeElement = input;
  const editableCopyEvent = new FakeEvent("copy", input);
  let editablePageListenerHits = 0;
  input.addEventListener("copy", () => {
    editablePageListenerHits += 1;
  });
  input.dispatchEvent(editableCopyEvent);

  assert.equal(editablePageListenerHits, 1);
  assert.equal(editableCopyEvent.defaultPrevented, false);
});

test("mutation observer reapplies safely and batches repeated changes", () => {
  const { documentRef, windowRef } = installEnvironment();
  const timers = createTimerHarness();
  const engine = createPageUnlockEngine({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    setTimeoutRef: timers.setTimeoutRef,
    clearTimeoutRef: timers.clearTimeoutRef,
  });
  engine.bootstrap();
  const styleBefore = documentRef.getElementById("writior-content-unlock-style");
  styleBefore.remove();

  const observer = FakeMutationObserver.instances.at(-1);
  observer.trigger([{ type: "childList" }]);
  observer.trigger([{ type: "childList" }]);
  assert.equal(engine.getState().appliedCount, 1);
  assert.equal(timers.pending, 1);

  timers.flush();
  assert.ok(documentRef.getElementById("writior-content-unlock-style"));
  assert.equal(engine.getState().appliedCount, 2);
});

test("soft ad cleanup hides obvious overlay candidates and leaves normal content intact", () => {
  const { documentRef, windowRef } = installEnvironment();
  const timers = createTimerHarness();
  const engine = createPageUnlockEngine({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    setTimeoutRef: timers.setTimeoutRef,
    clearTimeoutRef: timers.clearTimeoutRef,
  });

  const ad = documentRef.createElement("div");
  ad.id = "newsletter-banner";
  ad.className = "sticky sponsor-unit";
  ad.style.position = "fixed";
  ad.style.zIndex = "1000";
  documentRef.body.appendChild(ad);

  const article = documentRef.createElement("article");
  article.id = "main-story";
  documentRef.body.appendChild(article);

  engine.bootstrap();

  assert.equal(ad.getAttribute("data-writior-soft-hidden"), "true");
  assert.equal(ad.style.display, "none");
  assert.equal(article.getAttribute("data-writior-soft-hidden"), null);
});

test("content runtime bootstrap remains local and reusable", () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const environment = installEnvironment();
  globalThis.window = environment.windowRef;
  globalThis.document = environment.documentRef;
  try {
    const runtime = createContentRuntime();
    assert.equal(runtime.kind, "content-runtime");
    assert.equal(runtime.messageNames.AUTH_GET_STATE, "auth.get_state");
    assert.equal(runtime.storageKeys.AUTH_SESSION, "writior_auth_session");
    assert.equal(runtime.utilities.probePageContext().location, "https://example.com/article");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
