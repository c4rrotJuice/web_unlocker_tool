import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { buildWorkInEditorPayload } from "../extension/shared/types/work_in_editor.js";
import { createSelectionRuntime } from "../extension/content/selection/index.js";
import { createSidepanelClient } from "../extension/sidepanel/messaging/client.js";
import { renderSidepanelShell } from "../extension/sidepanel/app/index.js";

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
    this.style = {};
    this.textContent = "";
    this.value = "";
    this._innerHTML = "";
    this.id = "";
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === "id") {
      this.id = normalized;
    }
  }

  getAttribute(name) {
    if (name === "id") {
      return this.id || null;
    }
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

  attachShadow() {
    if (!this.shadowRoot) {
      this.shadowRoot = new FakeElement("#shadow-root", this.ownerDocument);
    }
    return this.shadowRoot;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
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
    this.title = "Editor Demo";
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

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function findByText(node, text) {
  if (!node) {
    return null;
  }
  if (typeof node.textContent === "string" && node.textContent === text) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findByText(child, text);
    if (match) {
      return match;
    }
  }
  if (node.shadowRoot) {
    const match = findByText(node.shadowRoot, text);
    if (match) {
      return match;
    }
  }
  return null;
}

function createChromeStub(storage = {}) {
  const messages = [];
  const tabsCreateCalls = [];
  const chromeApi = {
    messages,
    tabsCreateCalls,
    _dispatch: null,
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        messages.push(message);
        Promise.resolve()
          .then(() => chromeApi._dispatch?.(message, { tab: { id: 1, windowId: 1 } }))
          .then((response) => callback?.(response))
          .catch((error) => callback?.({ ok: false, status: "error", error: { code: "network_error", message: error?.message || String(error) } }));
      },
    },
    tabs: {
      async create(args) {
        tabsCreateCalls.push(args);
        return args;
      },
    },
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        },
        async remove(key) {
          delete storage[key];
        },
      },
    },
  };
  return chromeApi;
}

function createFetchStub({ signedIn = true, workInEditorBody, citationsBody, notesBody } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const normalizedUrl = String(url);
    requests.push({
      url: normalizedUrl,
      headers: Object.fromEntries(new Headers(init.headers || {}).entries()),
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (normalizedUrl.endsWith("/api/extension/bootstrap")) {
      return createResponse(signedIn ? {
        ok: true,
        data: {
          profile: { id: "user-1", display_name: "Researcher", email: "user@example.com" },
          entitlement: { tier: "pro", status: "active" },
          capabilities: { citation_styles: ["apa", "mla", "chicago", "harvard"], unlocks: true, documents: {} },
          app: { origin: "https://app.writior.com", handoff: { preferred_destination: "/editor" } },
          taxonomy: { recent_projects: [{ id: "project-1" }], recent_tags: [{ id: "tag-1" }] },
        },
      } : { ok: true, data: { profile: null, entitlement: null, capabilities: null, app: null, taxonomy: null } });
    }
    if (normalizedUrl.startsWith("https://app.writior.com/api/citations?")) {
      return createResponse(citationsBody || { ok: true, data: [] });
    }
    if (normalizedUrl.startsWith("https://app.writior.com/api/notes?")) {
      return createResponse(notesBody || { ok: true, data: [] });
    }
    if (normalizedUrl.endsWith("/api/extension/work-in-editor")) {
      return createResponse(workInEditorBody || {
        ok: true,
        data: {
          document_id: "doc-1",
          seed: { source: "selection_pill" },
          redirect_path: "/editor",
          editor_path: "/editor/doc-1",
          editor_url: "https://app.writior.com/editor/from-backend?seed=doc-1",
          document: { id: "doc-1" },
          citation: { id: "citation-1" },
          quote: { id: "quote-1" },
          note: { id: "note-1" },
        },
      });
    }
    return createResponse({ ok: true, data: null });
  };
  return { fetchImpl, requests };
}

function installSelection(documentRef, text = "Select this text") {
  const anchor = documentRef.createElement("div");
  documentRef.body.appendChild(anchor);
  const range = new FakeRange({ left: 120, top: 160, right: 360, bottom: 184, width: 240, height: 24 }, anchor);
  documentRef.setSelection(new FakeSelection(text, range, { anchorNode: anchor, focusNode: anchor }));
}

test("work-in-editor opens the backend-returned editor_url from the content pill", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  const windowRef = new FakeEventTarget();
  windowRef.location = { href: "https://example.com/articles/demo" };
  windowRef.innerWidth = 1024;
  windowRef.innerHeight = 768;
  windowRef.getComputedStyle = (node) => node.style || {};
  globalThis.document = documentRef;
  globalThis.window = windowRef;
  try {
    const { fetchImpl } = createFetchStub();
    const chromeApi = createChromeStub({
      writior_auth_session: {
        access_token: "token-1",
        token_type: "bearer",
        user_id: "user-1",
        email: "user@example.com",
        source: "background",
      },
    });
    const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });
    chromeApi._dispatch = runtime.dispatch.bind(runtime);

    installSelection(documentRef);
    const selectionRuntime = createSelectionRuntime({
      documentRef,
      windowRef,
      MutationObserverRef: FakeMutationObserver,
      setTimeoutRef: (callback) => {
        callback();
        return 1;
      },
      clearTimeoutRef() {},
      navigatorRef: { clipboard: { async writeText() {} } },
      chromeApi,
    });
    selectionRuntime.bootstrap();

    const editorButton = findByText(documentRef.body, "Editor");
    assert.ok(editorButton);
    editorButton.dispatchEvent(new FakeEvent("click", editorButton));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(chromeApi.tabsCreateCalls[0].url, "https://app.writior.com/editor/from-backend?seed=doc-1");
    assert.equal(chromeApi.messages.some((message) => message.type === MESSAGE_NAMES.WORK_IN_EDITOR), true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("work-in-editor can be triggered from the sidepanel and opens the backend-returned editor_url", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  const windowRef = new FakeEventTarget();
  windowRef.location = { href: "https://app.writior.com/sidepanel" };
  windowRef.getComputedStyle = (node) => node.style || {};
  globalThis.document = documentRef;
  globalThis.window = windowRef;
  try {
    const { fetchImpl } = createFetchStub({
      signedIn: true,
      notesBody: {
        ok: true,
        data: [
          {
            id: "note-1",
            title: "Field note",
            note_body: "Note body text",
            highlight_text: "Highlight text",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
    });
    const chromeApi = createChromeStub({
      writior_auth_session: {
        access_token: "token-1",
        token_type: "bearer",
        user_id: "user-1",
        email: "user@example.com",
        source: "background",
      },
    });
    const runtime = createBackgroundRuntime({ chromeApi, fetchImpl, baseUrl: "https://app.writior.com" });
    chromeApi._dispatch = runtime.dispatch.bind(runtime);
    const client = createSidepanelClient(chromeApi);
    const root = documentRef.createElement("div");
    const shell = renderSidepanelShell(root, {
      client,
      chromeApi,
      documentRef,
      navigatorRef: { clipboard: { async writeText() {} } },
    });
    await shell.refresh();

    const notesTab = findByText(root.shadowRoot || root, "Notes");
    assert.ok(notesTab);
    notesTab.dispatchEvent(new FakeEvent("click", notesTab));
    assert.equal(shell.getState().active_tab, "notes");
    const response = await runtime.dispatch({
      type: MESSAGE_NAMES.WORK_IN_EDITOR,
      payload: buildWorkInEditorPayload({
        selectionText: "Note body text",
      pageTitle: "Field note",
      noteText: "Note body text",
      commentaryText: "Note body text",
      source: "sidepanel",
      }),
    }, { tab: { id: 1, windowId: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(response.ok, true);
    assert.ok(chromeApi.tabsCreateCalls.length > 0, "expected work-in-editor to open a tab");
    assert.equal(chromeApi.tabsCreateCalls[0].url, "https://app.writior.com/editor/from-backend?seed=doc-1");
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("unauthenticated work-in-editor requests fail cleanly before any tab opens", async () => {
  const chromeApi = createChromeStub();
  const { fetchImpl, requests } = createFetchStub({ signedIn: true });
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
  });
  chromeApi._dispatch = runtime.dispatch.bind(runtime);

  const response = await runtime.dispatch({
    type: MESSAGE_NAMES.WORK_IN_EDITOR,
    payload: buildWorkInEditorPayload({
      selectionText: "No token",
      pageTitle: "Demo",
      pageUrl: "https://example.com/demo",
      pageDomain: "example.com",
    }),
  }, { tab: { id: 1, windowId: 1 } });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "unauthorized");
  assert.equal(chromeApi.tabsCreateCalls.length, 0);
  assert.equal(requests.length, 0);
});

test("malformed work-in-editor responses are rejected as contract errors", async () => {
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  });
  const { fetchImpl, requests } = createFetchStub({
    signedIn: true,
    workInEditorBody: {
      ok: true,
      data: {
        document_id: "doc-1",
        editor_path: "/editor/doc-1",
        redirect_path: "/editor",
      },
    },
  });
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
  });
  chromeApi._dispatch = runtime.dispatch.bind(runtime);

  const response = await runtime.dispatch({
    type: MESSAGE_NAMES.WORK_IN_EDITOR,
    payload: buildWorkInEditorPayload({
      selectionText: "Bad response",
      pageTitle: "Demo",
      pageUrl: "https://example.com/demo",
      pageDomain: "example.com",
    }),
  }, { tab: { id: 1, windowId: 1 } });

  assert.equal(requests.some((entry) => entry.url.endsWith("/api/extension/work-in-editor")), true);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "invalid_payload");
  assert.equal(chromeApi.tabsCreateCalls.length, 0);
});
