import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { createSelectionMenu } from "../extension/content/ui/selection_menu.js";
import { createSelectionRuntime } from "../extension/content/selection/index.js";
import { renderPopupAuthSnapshot } from "../extension/popup/app/index.js";
import { renderSidepanelAuthSnapshot } from "../extension/sidepanel/app/index.js";
import { createCitationStyleTabs } from "../extension/sidepanel/components/citation_style_tabs.js";
import { normalizeCapabilitySurface } from "../extension/shared/types/capability_surface.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.key = init.key || "";
    this.defaultPrevented = false;
    this.propagationStopped = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
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
    this.id = "";
    this._innerHTML = "";
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

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.documentElement.appendChild(this.body);
    this.title = "Demo";
    this._selection = null;
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getSelection() {
    return this._selection;
  }

  setSelection(selection) {
    this._selection = selection;
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

function collectText(node) {
  if (!node) {
    return "";
  }
  const pieces = [];
  if (typeof node.innerHTML === "string" && node.innerHTML.trim()) {
    pieces.push(node.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
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

function createChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  const chromeApi = {
    messages: [],
    tabsCreateCalls: [],
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage() {},
    },
    tabs: {
      async create(args) {
        chromeApi.tabsCreateCalls.push(args);
        return args;
      },
    },
    sidePanel: {
      open() {},
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

function createFetchStub({ workInEditorBody, bootstrapBody, signedIn = true } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const normalizedUrl = String(url);
    requests.push({
      url: normalizedUrl,
      headers: Object.fromEntries(new Headers(init.headers || {}).entries()),
      body: init.body ? JSON.parse(init.body) : null,
    });
    if (normalizedUrl.endsWith("/api/extension/bootstrap")) {
      return createResponse(
        bootstrapBody || (signedIn ? {
          ok: true,
          data: {
            profile: { id: "user-1", display_name: "Researcher", email: "user@example.com" },
            entitlement: { tier: "pro", status: "active" },
            capabilities: {
              citation_styles: ["apa", "mla", "chicago", "harvard"],
              unlocks: true,
              selection_actions: { work_in_editor: true, cite: true, note: true, quote: true },
              usage: {
                tier: "pro",
                citations_remaining: "unlimited",
                notes_remaining: "unlimited",
              },
            },
            app: { handoff: { preferred_destination: "/editor" } },
            taxonomy: { recent_projects: [{ id: "project-1" }], recent_tags: [{ id: "tag-1" }] },
          },
        } : {
          ok: true,
          data: {
            profile: null,
            entitlement: null,
            capabilities: null,
            app: null,
            taxonomy: null,
          },
        }),
      );
    }
    if (normalizedUrl.endsWith("/api/extension/work-in-editor")) {
      return createResponse(
        workInEditorBody || {
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
        },
      );
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

test("guest/free/standard/pro snapshots render backend-confirmed tier and usage", () => {
  const documentRef = new FakeDocument();
  const popupRoot = documentRef.createElement("div");
  const sidepanelRoot = documentRef.createElement("div");

  renderPopupAuthSnapshot(popupRoot, { status: "signed_out" });
  renderSidepanelAuthSnapshot(sidepanelRoot, { status: "signed_out" });
  assert.match(collectText(popupRoot), /Tier guest/);
  assert.match(collectText(sidepanelRoot), /Tier: guest/);

  const freeSnapshot = {
    status: "signed_in",
    session: { email: "free@example.com" },
    bootstrap: {
      profile: { display_name: "Free User" },
      entitlement: { tier: "free", status: "active" },
      capabilities: {
        citation_styles: ["apa", "mla"],
        selection_actions: { copy: true, cite: true, note: true, quote: true, work_in_editor: false },
        usage: { tier: "free", citations_remaining: "12", notes_remaining: "4" },
      },
      taxonomy: { recent_projects: [{ id: "p-1" }], recent_tags: [{ id: "t-1" }, { id: "t-2" }] },
    },
  };
  const freeSurface = normalizeCapabilitySurface({ auth: freeSnapshot });
  assert.equal(freeSurface.tier, "free");
  assert.equal(freeSurface.actionAvailability.cite, true);
  assert.equal(freeSurface.actionAvailability.work_in_editor, false);
  assert.match(renderPopupText(freeSnapshot), /Tier free/);
  assert.match(renderSidepanelText(freeSnapshot), /Tier: free/);

  const proSnapshot = {
    status: "signed_in",
    session: { email: "pro@example.com" },
    bootstrap: {
      profile: { display_name: "Pro User" },
      entitlement: { tier: "pro", status: "active" },
      capabilities: {
        citation_styles: ["apa", "mla", "chicago", "harvard"],
        unlocks: true,
        usage: { tier: "pro", history: "enabled", exports: "enabled" },
      },
      taxonomy: { recent_projects: [{ id: "p-1" }, { id: "p-2" }], recent_tags: [{ id: "t-1" }] },
    },
  };
  const proSurface = normalizeCapabilitySurface({ auth: proSnapshot });
  assert.equal(proSurface.tier, "pro");
  assert.equal(proSurface.usageItems.some((item) => item.label === "History"), true);
  assert.match(renderPopupText(proSnapshot), /Tier pro/);
  assert.match(renderSidepanelText(proSnapshot), /Tier: pro/);

  function renderPopupText(snapshot) {
    const root = documentRef.createElement("div");
    renderPopupAuthSnapshot(root, snapshot);
    return collectText(root);
  }

  function renderSidepanelText(snapshot) {
    const root = documentRef.createElement("div");
    renderSidepanelAuthSnapshot(root, snapshot);
    return collectText(root);
  }
});

test("locked styles and locked actions render distinctly from disabled states", () => {
  const documentRef = new FakeDocument();
  const styleTabs = createCitationStyleTabs({
    documentRef,
    lockedStyles: ["chicago", "harvard"],
    onSelect() {},
  });
  const buttons = styleTabs.root.children;
  const chicago = Array.from(buttons).find((button) => button.getAttribute("data-style") === "chicago");
  const mla = Array.from(buttons).find((button) => button.getAttribute("data-style") === "mla");
  assert.equal(chicago.getAttribute("data-locked"), "true");
  assert.equal(chicago.disabled, true);
  assert.equal(mla.getAttribute("data-locked"), null);
  assert.equal(mla.disabled, false);

  const menu = createSelectionMenu({
    documentRef,
    actions: [
      { key: "copy", label: "Copy", active: true, locked: false },
      { key: "cite", label: "Cite", active: false, locked: true },
    ],
    onAction() {},
  });
  const citeButton = Array.from(menu.root.children).find((button) => button.getAttribute("data-selection-action") === "cite");
  assert.equal(citeButton.getAttribute("data-locked"), "true");
  assert.equal(citeButton.disabled, true);
});

test("stale capability cache cannot bypass backend denial", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  const windowRef = new FakeEventTarget();
  windowRef.location = { href: "https://example.com/articles/demo" };
  windowRef.innerWidth = 1024;
  windowRef.innerHeight = 768;
  windowRef.setTimeout = globalThis.setTimeout.bind(globalThis);
  globalThis.document = documentRef;
  globalThis.window = windowRef;
  try {
    const { fetchImpl } = createFetchStub({
      workInEditorBody: {
        ok: false,
        error: { code: "unauthorized", message: "Access denied." },
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
    const runtime = createBackgroundRuntime({
      chromeApi,
      fetchImpl,
      baseUrl: "https://app.writior.com",
    });
    await runtime.bootstrap();
    chromeApi.runtime.sendMessage = (message, callback) => {
      chromeApi.messages.push(message);
      Promise.resolve(runtime.dispatch(message, { tab: { id: 1, windowId: 1 } }))
        .then((response) => callback?.(response))
        .catch((error) => callback?.({ ok: false, error: { code: "network_error", message: error?.message || String(error) } }));
    };

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
    await new Promise((resolve) => setTimeout(resolve, 0));

    const editorButton = findByText(documentRef.body, "Editor");
    assert.ok(editorButton);
    editorButton.dispatchEvent(new FakeEvent("click", editorButton));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(chromeApi.tabsCreateCalls?.length || 0, 0);
    assert.equal(chromeApi.messages.some((message) => message.type === MESSAGE_NAMES.WORK_IN_EDITOR), true);
    assert.match(selectionRuntime.getState().pill.lastMessage, /Access denied|failed/i);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
