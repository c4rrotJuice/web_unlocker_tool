import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { createSelectionRuntime } from "../extension/content/selection/index.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.key = init.key || "";
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.immediatePropagationStopped = false;
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
    this.id = "";
    this.className = "";
    this.style = {};
    this.textContent = "";
    this.dataset = {};
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
    if (name === "lang") {
      this.lang = normalized;
    }
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
    if (!this.parentNode) {
      return;
    }
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
    return this._rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
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
  constructor(text, range, { anchorNode, focusNode } = {}) {
    this._text = text;
    this._range = range;
    this.anchorNode = anchorNode;
    this.focusNode = focusNode;
    this.anchorOffset = 0;
    this.focusOffset = String(text || "").length;
    this.rangeCount = range ? 1 : 0;
    this.isCollapsed = !String(text || "").trim();
  }

  toString() {
    return this._text;
  }

  getRangeAt(index) {
    if (index !== 0 || !this._range) {
      throw new RangeError("out of bounds");
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
    this.title = "Capture Demo";
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
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}

  disconnect() {}
}

function createTimerHarness() {
  const timers = [];
  return {
    setTimeoutRef(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeoutRef() {},
    flush() {
      while (timers.length) {
        const callback = timers.shift();
        callback();
      }
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

function setSelection(documentRef, text = "Capture this text") {
  const anchor = documentRef.createElement("div");
  documentRef.body.appendChild(anchor);
  const range = new FakeRange({ left: 120, top: 160, right: 360, bottom: 184, width: 240, height: 24 }, anchor);
  documentRef.setSelection(new FakeSelection(text, range, { anchorNode: anchor, focusNode: anchor }));
  documentRef.dispatchEvent(new FakeEvent("selectionchange", documentRef));
  return anchor;
}

function createChromeStub(runtimeDispatch) {
  return {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        Promise.resolve(runtimeDispatch(message)).then((response) => {
          if (typeof callback === "function") {
            callback(response);
          }
        });
      },
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults };
        },
        async set() {},
        async remove() {},
      },
    },
  };
}

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createCaptureFetchStub() {
  const calls = [];
  const api = {
    calls,
    createCitation(payload) {
      calls.push({ kind: "citation", payload });
      return Promise.resolve({ ok: true, status: "ok", data: { id: "cit-1", title: payload.pageTitle, style: "apa", format: "bibliography" } });
    },
    createQuote(payload) {
      calls.push({ kind: "quote", payload });
      return Promise.resolve({ ok: false, status: "error", error: { code: "quote_rejected", message: "Quote rejected." } });
    },
    createNote(payload) {
      calls.push({ kind: "note", payload });
      return Promise.resolve({ ok: true, status: "ok", data: { note: { id: "note-1", body: payload.noteText || payload.selectionText } } });
    },
  };
  return api;
}

function findChildByText(node, text) {
  if (!node) {
    return null;
  }
  for (const child of node.children || []) {
    if (typeof child.textContent === "string" && child.textContent === text) {
      return child;
    }
  }
  return null;
}

function read(file) {
  return fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

test("capture actions are typed content messages and the background is the sole network authority", async () => {
  const { documentRef, windowRef } = installEnvironment();
  const timers = createTimerHarness();
  const captureApi = createCaptureFetchStub();
  let runtime;
  const chromeApi = createChromeStub((message) => runtime.dispatch(message));
  chromeApi.storage = {
    local: {
      async get(defaults) {
        return {
          ...defaults,
          writior_auth_session: {
            access_token: "token-1",
            token_type: "bearer",
            user_id: "user-1",
            email: "user@example.com",
            source: "background",
          },
        };
      },
      async set() {},
      async remove() {},
    },
  };
  runtime = createBackgroundRuntime({
    chromeApi,
    captureApi,
    baseUrl: "https://app.writior.com",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/api/extension/bootstrap")) {
        return createResponse({
          ok: true,
          data: {
            profile: { display_name: "User One" },
            entitlement: { tier: "standard" },
            capabilities: { tier: "standard", unlocks: true, documents: {} },
            app: { handoff: { preferred_destination: "/editor" } },
            taxonomy: { recent_projects: [], recent_tags: [] },
          },
        });
      }
      throw new Error("content should not fetch");
    },
  });
  await runtime.bootstrap();
  const selectionRuntime = createSelectionRuntime({
    documentRef,
    windowRef,
    MutationObserverRef: FakeMutationObserver,
    setTimeoutRef: timers.setTimeoutRef,
    clearTimeoutRef: timers.clearTimeoutRef,
    chromeApi,
  });

  setSelection(documentRef, "Capture this citation text");
  selectionRuntime.bootstrap();
  timers.flush();

  const menuRoot = selectionRuntime.pill.panel.children[1];
  const copyButton = findChildByText(menuRoot, "Copy");
  const citeButton = findChildByText(menuRoot, "Cite");
  const noteButton = findChildByText(menuRoot, "Note");
  const quoteButton = findChildByText(menuRoot, "Quote");
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  await citeButton.dispatchEvent(new FakeEvent("click", citeButton));
  await tick();
  assert.equal(selectionRuntime.pill.getState().lastMessage, "Saved");
  await noteButton.dispatchEvent(new FakeEvent("click", noteButton));
  await tick();
  assert.equal(selectionRuntime.pill.getState().lastMessage, "Saved");
  await quoteButton.dispatchEvent(new FakeEvent("click", quoteButton));
  await tick();

  assert.equal(captureApi.calls.length, 3);
  assert.deepEqual(
    captureApi.calls.map((call) => call.kind),
    ["citation", "note", "quote"],
  );
  assert.equal(captureApi.calls[0].payload.selectionText, "Capture this citation text");
  assert.equal(captureApi.calls[0].payload.pageTitle, "Capture Demo");
  assert.equal(captureApi.calls[0].payload.pageUrl, "https://example.com/articles/demo");
  assert.equal(captureApi.calls[0].payload.pageDomain, "example.com");
  assert.equal(read("extension/content/selection/index.ts").includes("fetch("), false);
});

test("capture payloads reject malformed input before the API call", async () => {
  const captureApi = createCaptureFetchStub();
  const runtime = createBackgroundRuntime({
    chromeApi: {
      runtime: {
        lastError: null,
        sendMessage() {},
      },
      storage: {
        local: {
          async get(defaults) {
            return { ...defaults };
          },
          async set() {},
          async remove() {},
        },
      },
    },
    captureApi,
    baseUrl: "https://app.writior.com",
  });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.CAPTURE_CREATE_CITATION,
    payload: { pageUrl: "", pageDomain: "", selectionText: "" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_payload");
  assert.equal(captureApi.calls.length, 0);
});

test("canonical capture entity responses flow through background unchanged", async () => {
  const captureApi = createCaptureFetchStub();
  const runtime = createBackgroundRuntime({
    chromeApi: {
      runtime: {
        lastError: null,
        sendMessage() {},
      },
      storage: {
        local: {
          async get(defaults) {
            return { ...defaults };
          },
          async set() {},
          async remove() {},
        },
      },
    },
    captureApi,
    baseUrl: "https://app.writior.com",
  });

  const citation = await runtime.dispatch({
    type: MESSAGE_NAMES.CAPTURE_CREATE_CITATION,
    payload: {
      selectionText: "Canonical citation text",
      pageTitle: "Capture Demo",
      pageUrl: "https://example.com/articles/demo",
      pageDomain: "example.com",
      metadata: { description: "Demo article" },
    },
  });

  const note = await runtime.dispatch({
    type: MESSAGE_NAMES.CAPTURE_CREATE_NOTE,
    payload: {
      selectionText: "Plain note text",
      pageTitle: "Capture Demo",
      pageUrl: "https://example.com/articles/demo",
      pageDomain: "example.com",
    },
  });

  assert.equal(citation.ok, true);
  assert.equal(citation.data.id, "cit-1");
  assert.equal(note.ok, true);
  assert.equal(note.data.note.id, "note-1");
});

test("quote failures surface as traceable errors", async () => {
  const captureApi = createCaptureFetchStub();
  const runtime = createBackgroundRuntime({
    chromeApi: {
      runtime: {
        lastError: null,
        sendMessage() {},
      },
      storage: {
        local: {
          async get(defaults) {
            return { ...defaults };
          },
          async set() {},
          async remove() {},
        },
      },
    },
    captureApi,
    baseUrl: "https://app.writior.com",
  });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.CAPTURE_CREATE_QUOTE,
    payload: {
      selectionText: "Quote text",
      pageTitle: "Capture Demo",
      pageUrl: "https://example.com/articles/demo",
      pageDomain: "example.com",
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "quote_rejected");
  assert.match(result.error.message, /Quote rejected/);
});
