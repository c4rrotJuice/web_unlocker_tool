import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { createPageUnlockEngine } from "../extension/content/page/unlock_engine.js";
import { createSelectionRuntime } from "../extension/content/selection/index.js";
import { computePillPosition } from "../extension/content/selection/position.js";
import { createContentRuntime } from "../extension/content/index.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
    this.key = init.key || "";
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
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
    this.contentEditable = "";
    this.isContentEditable = false;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === "id") this.id = normalized;
    if (name === "class") this.className = normalized;
    if (name === "lang") this.lang = normalized;
    if (name === "contenteditable") {
      this.contentEditable = normalized;
      this.isContentEditable = normalized === "" || normalized === "true" || normalized === "plaintext-only";
    }
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name === "lang") return this.lang || null;
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

  attachShadow() {
    if (!this.shadowRoot) {
      this.shadowRoot = new FakeElement("#shadow-root", this.ownerDocument);
    }
    return this.shadowRoot;
  }

  getBoundingClientRect() {
    return this._rect || {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    };
  }

  setBoundingClientRect(rect) {
    this._rect = rect;
  }
}

class FakeRange {
  constructor(rect, commonAncestorContainer) {
    this._rect = rect;
    this.commonAncestorContainer = commonAncestorContainer;
    this.startContainer = commonAncestorContainer;
    this.endContainer = commonAncestorContainer;
  }

  getBoundingClientRect() {
    return this._rect;
  }

  getClientRects() {
    return [this._rect];
  }
}

class FakeSelection {
  constructor(text, range, { anchorNode, focusNode, anchorOffset = 0, focusOffset = 0 } = {}) {
    this._text = text;
    this._range = range;
    this.anchorNode = anchorNode;
    this.focusNode = focusNode;
    this.anchorOffset = anchorOffset;
    this.focusOffset = focusOffset;
    this.rangeCount = range ? 1 : 0;
    this.isCollapsed = !String(text || "").trim();
  }

  toString() {
    return this._text;
  }

  getRangeAt(index) {
    if (index !== 0 || !this._range) {
      throw new RangeError("range index out of bounds");
    }
    return this._range;
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
    this.title = "";
    this.activeElement = null;
    this._selection = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this._walk(this.documentElement).find((node) => node.id === id) || null;
  }

  getSelection() {
    return this._selection;
  }

  setSelection(selection) {
    this._selection = selection;
  }

  execCommand(command) {
    this.lastExecCommand = command;
    return this.execCommandResult ?? false;
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
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }

  observe() {}

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
  windowRef.location = { href: "https://example.com/articles/demo" };
  windowRef.innerWidth = 1024;
  windowRef.innerHeight = 768;
  windowRef.getComputedStyle = (node) => node.style || {};
  return { documentRef, windowRef };
}

function setPageMetadata(documentRef) {
  documentRef.title = "Demo Article";
  documentRef.documentElement.setAttribute("lang", "en");
  const meta = (attrs) => {
    const node = documentRef.createElement("meta");
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    documentRef.head.appendChild(node);
    return node;
  };
  const link = (attrs) => {
    const node = documentRef.createElement("link");
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, value);
    }
    documentRef.head.appendChild(node);
    return node;
  };
  meta({ name: "description", content: "Demo description" });
  meta({ name: "author", content: "A. Author" });
  meta({ property: "og:site_name", content: "Writior Demo" });
  link({ rel: "canonical", href: "https://example.com/articles/demo" });
}

function readSource(file) {
  return fs.readFileSync(path.join("extension", file), "utf8");
}

function createSelectionEnvironment({ withUnlockEngine = false } = {}) {
  const { documentRef, windowRef } = installEnvironment();
  setPageMetadata(documentRef);
  const timers = createTimerHarness();
  const navigatorRef = {
    clipboard: {
      async writeText() {},
    },
  };
  const unlockEngine = withUnlockEngine
    ? createPageUnlockEngine({
        documentRef,
        windowRef,
        MutationObserverRef: FakeMutationObserver,
        setTimeoutRef: timers.setTimeoutRef,
        clearTimeoutRef: timers.clearTimeoutRef,
      })
    : null;
  const runtime = createSelectionRuntime({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    setTimeoutRef: timers.setTimeoutRef,
    clearTimeoutRef: timers.clearTimeoutRef,
    navigatorRef,
  });
  return { documentRef, windowRef, timers, runtime, unlockEngine };
}

function setSelection(documentRef, {
  text,
  rect,
  anchorNode,
  focusNode,
  anchorOffset = 0,
  focusOffset = 0,
} = {}) {
  const range = new FakeRange(rect, anchorNode || focusNode);
  const selection = new FakeSelection(text, range, {
    anchorNode,
    focusNode,
    anchorOffset,
    focusOffset,
  });
  documentRef.setSelection(selection);
  documentRef.dispatchEvent(new FakeEvent("selectionchange", documentRef));
}

test("content runtime includes the new selection stack and keeps content-only boundaries", () => {
  const source = readSource("content/index.ts");
  assert.match(source, /createSelectionRuntime/);
  assert.match(source, /createPageUnlockEngine/);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("chrome.storage"), false);
});

test("pill appears near valid selections and exposes a copy-only capture payload shape", () => {
  const { documentRef, runtime, timers } = createSelectionEnvironment();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "  Long selection to copy for later capture  ",
    rect: { left: 200, top: 180, right: 540, bottom: 204, width: 340, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
    anchorOffset: 2,
    focusOffset: 38,
  });

  runtime.bootstrap();
  timers.flush();

  const state = runtime.getState();
  assert.equal(state.visible, true);
  assert.equal(state.pill.visible, true);
  assert.equal(state.pill.previewText, "");
  assert.ok(state.pill.position.top < 180);
  assert.equal(documentRef.getElementById("writior-selection-pill") !== null, true);
  assert.equal(state.currentSnapshot.payload.version, 1);
  assert.equal(state.currentSnapshot.payload.capture.selectionText, "Long selection to copy for later capture");
  assert.equal(state.currentSnapshot.payload.capture.pageTitle, "Demo Article");
  assert.equal(state.currentSnapshot.payload.capture.pageUrl, "https://example.com/articles/demo");
  assert.equal(state.currentSnapshot.payload.capture.pageDomain, "example.com");
});

test("short selection rejected and editable surfaces ignored", () => {
  const { documentRef, runtime } = createSelectionEnvironment();
  const input = documentRef.createElement("input");
  documentRef.body.appendChild(input);
  documentRef.activeElement = input;
  setSelection(documentRef, {
    text: "ab",
    rect: { left: 40, top: 40, right: 56, bottom: 60, width: 16, height: 20 },
    anchorNode: input,
    focusNode: input,
  });
  runtime.bootstrap();

  assert.equal(runtime.getState().visible, false);
  assert.equal(documentRef.getElementById("writior-selection-pill"), null);
});

test("escape and outside click dismiss the pill", () => {
  const { documentRef, runtime } = createSelectionEnvironment();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "A selection that should dismiss",
    rect: { left: 180, top: 140, right: 420, bottom: 164, width: 240, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  runtime.bootstrap();

  documentRef.dispatchEvent(new FakeEvent("keydown", documentRef, { key: "Escape" }));
  assert.equal(runtime.getState().visible, false);

  setSelection(documentRef, {
    text: "A selection that should dismiss",
    rect: { left: 180, top: 140, right: 420, bottom: 164, width: 240, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  runtime.inspectSelection();
  const outside = documentRef.createElement("div");
  documentRef.body.appendChild(outside);
  documentRef.dispatchEvent(new FakeEvent("click", outside));

  assert.equal(runtime.getState().visible, false);
  assert.equal(runtime.getState().lastDismissReason, "outside_click");
});

test("copy action is instant and feedback updates for success and failure", async () => {
  const { documentRef, runtime } = createSelectionEnvironment();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "Copy this line",
    rect: { left: 120, top: 200, right: 300, bottom: 224, width: 180, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  runtime.bootstrap();

  const copyButton = runtime.pill.panel.children[0].children[0];
  await copyButton.dispatchEvent(new FakeEvent("click", copyButton));
  await Promise.resolve();
  assert.equal(runtime.getState().pill.lastMessage, "Copied");

  const failingRuntime = createSelectionRuntime({
    documentRef,
    windowRef: installEnvironment().windowRef,
    MutationObserverRef: FakeMutationObserver,
    navigatorRef: {
      clipboard: {
        async writeText() {
          throw new Error("blocked");
        },
      },
    },
    setTimeoutRef: createTimerHarness().setTimeoutRef,
    clearTimeoutRef: createTimerHarness().clearTimeoutRef,
  });
  failingRuntime.bootstrap();
  failingRuntime.inspectSelection();
  const failingButton = failingRuntime.pill.panel.children[0].children[0];
  documentRef.execCommandResult = false;
  await failingButton.dispatchEvent(new FakeEvent("click", failingButton));
  await Promise.resolve();
  assert.equal(failingRuntime.getState().pill.lastMessage, "Copy failed");
});

test("copy action falls back to execCommand with a hidden textarea when clipboard API is blocked", async () => {
  const { documentRef } = createSelectionEnvironment();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "Fallback copy text",
    rect: { left: 120, top: 200, right: 300, bottom: 224, width: 180, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });

  documentRef.execCommandResult = true;
  const runtime = createSelectionRuntime({
    documentRef,
    windowRef: installEnvironment().windowRef,
    MutationObserverRef: FakeMutationObserver,
    navigatorRef: {
      clipboard: {
        async writeText() {
          throw new Error("blocked");
        },
      },
    },
    setTimeoutRef: createTimerHarness().setTimeoutRef,
    clearTimeoutRef: createTimerHarness().clearTimeoutRef,
  });
  runtime.bootstrap();
  runtime.inspectSelection();

  const copyButton = runtime.pill.panel.children[0].children[0];
  await copyButton.dispatchEvent(new FakeEvent("click", copyButton));
  await Promise.resolve();

  assert.equal(documentRef.lastExecCommand, "copy");
  assert.equal(runtime.getState().pill.lastMessage, "Copied");
});

test("cite opens a preview modal without persisting immediately", async () => {
  const { documentRef, windowRef } = installEnvironment();
  setPageMetadata(documentRef);
  const timers = createTimerHarness();
  const calls = [];
  const runtime = createSelectionRuntime({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    setTimeoutRef: timers.setTimeoutRef,
    clearTimeoutRef: timers.clearTimeoutRef,
    chromeApi: { runtime: { sendMessage() {} } },
    runtimeClientFactory() {
      return {
        authStatusGet: async () => ({ ok: true, data: { auth: { bootstrap: { capabilities: { citation_styles: ["apa", "mla"] } } } } }),
        previewCitation: async (payload) => {
          calls.push({ kind: "preview", payload });
          return {
            ok: true,
            data: {
              citation: {
                id: null,
                source_id: null,
                source: {
                  title: "Demo Article",
                  canonical_url: "https://example.com/articles/demo",
                  authors: [{ fullName: "A. Author" }],
                },
                renders: {
                  apa: {
                    bibliography: "Demo Article. Example citation output.",
                    inline: "(Demo Article, 2026)",
                    footnote: "Demo Article. Example footnote output.",
                    quote_attribution: "\"Preview selection\" (Demo Article, 2026)",
                  },
                },
              },
              render_bundle: {
                renders: {
                  apa: {
                    bibliography: "Demo Article. Example citation output.",
                    inline: "(Demo Article, 2026)",
                    footnote: "Demo Article. Example footnote output.",
                    quote_attribution: "\"Preview selection\" (Demo Article, 2026)",
                  },
                },
              },
            },
          };
        },
        renderCitation: async () => ({ ok: false, error: { code: "unused", message: "unused" } }),
        saveCitation: async () => ({ ok: true, data: { id: "citation-1", renders: { apa: { bibliography: "saved" } } } }),
      };
    },
  });
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "Preview selection",
    rect: { left: 120, top: 200, right: 300, bottom: 224, width: 180, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });

  runtime.bootstrap();
  timers.flush();

  const citeButton = runtime.pill.panel.children[0].children.find((child) => child.textContent === "Cite");
  await citeButton.dispatchEvent(new FakeEvent("click", citeButton));
  await Promise.resolve();

  assert.equal(calls.length, 1);
  assert.equal(runtime.citationModal.isVisible(), true);
  assert.equal(Boolean(runtime.citationModal.getState().citation?.id), false);
});

test("pill waits until pointer selection settles before rendering", () => {
  const { documentRef, runtime, timers } = createSelectionEnvironment();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  runtime.bootstrap();

  documentRef.dispatchEvent(new FakeEvent("pointerdown", selectionHost));
  setSelection(documentRef, {
    text: "Selection while dragging",
    rect: { left: 140, top: 220, right: 320, bottom: 244, width: 180, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  timers.flush();
  assert.equal(runtime.getState().visible, false);

  documentRef.dispatchEvent(new FakeEvent("pointerup", selectionHost));
  timers.flush();
  assert.equal(runtime.getState().visible, true);
});

test("duplicate pills are avoided and positions update on repeated selection changes", () => {
  const { documentRef, runtime, timers } = createSelectionEnvironment();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "Repeated selection",
    rect: { left: 260, top: 260, right: 420, bottom: 284, width: 160, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  runtime.bootstrap();
  timers.flush();
  const firstState = runtime.getState();
  const firstPosition = firstState.pill.position;

  setSelection(documentRef, {
    text: "Repeated selection",
    rect: { left: 310, top: 320, right: 470, bottom: 344, width: 160, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  timers.flush();
  const secondState = runtime.getState();

  assert.equal(documentRef.getElementById("writior-selection-pill") !== null, true);
  assert.equal(secondState.renderCount, 1);
  assert.notDeepEqual(secondState.pill.position, firstPosition);
});

test("pill positioning utility prefers above selection and clamps within viewport", () => {
  const position = computePillPosition({
    rect: { left: 20, top: 80, bottom: 104, width: 40, height: 24 },
    viewportWidth: 220,
    viewportHeight: 180,
    panelWidth: 180,
    panelHeight: 48,
  });

  assert.deepEqual(position, { top: 20, left: 8 });
});

test("hostile pages still show the pill when unlock and selection engines cooperate", () => {
  const { documentRef, windowRef, timers, runtime, unlockEngine } = createSelectionEnvironment({ withUnlockEngine: true });
  documentRef.documentElement.setAttribute("style", "user-select: none;");
  documentRef.body.setAttribute("style", "user-select: none;");
  unlockEngine.bootstrap();
  const selectionHost = documentRef.createElement("div");
  documentRef.body.appendChild(selectionHost);
  setSelection(documentRef, {
    text: "Selection on a hostile page",
    rect: { left: 180, top: 190, right: 420, bottom: 214, width: 240, height: 24 },
    anchorNode: selectionHost,
    focusNode: selectionHost,
  });
  runtime.bootstrap();
  timers.flush();

  assert.equal(runtime.getState().visible, true);
  assert.match(documentRef.getElementById("writior-copy-unlock-style").textContent, /user-select: text/);
  assert.equal(windowRef.location.href, "https://example.com/articles/demo");
});
