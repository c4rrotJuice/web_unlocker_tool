import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { createSidepanelShell } from "../extension/sidepanel/app/index.js";

class FakeEvent {
  constructor(type, target) {
    this.type = type;
    this.target = target;
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

  getElementById() {
    return null;
  }
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

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function createFetchStub({ signedIn = true, citationsBody, notesBody, renderBody } = {}) {
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
      } : {
        ok: true,
        data: {
          profile: null,
          entitlement: null,
          capabilities: null,
          app: null,
          taxonomy: null,
        },
      });
    }
    if (normalizedUrl.startsWith("https://app.writior.com/api/citations?")) {
      return createResponse(citationsBody || { ok: true, data: [] });
    }
    if (normalizedUrl.startsWith("https://app.writior.com/api/notes?")) {
      return createResponse(notesBody || { ok: true, data: [] });
    }
    if (normalizedUrl.endsWith("/api/citations/render")) {
      return createResponse(renderBody || {
        ok: true,
        data: {
          renders: {
            apa: {
              inline: "Rendered inline citation",
              bibliography: "Rendered APA citation",
              footnote: "Rendered footnote citation",
            },
          },
          cache_hit: false,
        },
      });
    }
    if (normalizedUrl.endsWith("/api/auth/handoff/exchange")) {
      return createResponse({
        ok: true,
        data: {
          redirect_path: "/editor",
          session: {
            access_token: "token-1",
            refresh_token: "refresh-1",
            token_type: "bearer",
            user_id: "user-1",
            email: "user@example.com",
          },
        },
      });
    }
    return createResponse({ ok: false, error: { code: "unexpected", message: normalizedUrl } }, 404);
  };
  return { fetchImpl, requests };
}

function createChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  const messages = [];
  const tabsCreateCalls = [];
  const chromeApi = {
    messages,
    tabsCreateCalls,
    _dispatch: null,
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      sendMessage(message, callback) {
        messages.push(message);
        Promise.resolve()
          .then(() => chromeApi._dispatch?.(message, { tab: { windowId: 1 } }))
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

function createRuntime({ signedIn = true, citationsBody, notesBody } = {}) {
  const chromeApi = createChromeStub(signedIn ? {
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
  } : {});
  const { fetchImpl, requests } = createFetchStub({ signedIn, citationsBody, notesBody });
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
  });
  chromeApi._dispatch = runtime.dispatch.bind(runtime);
  return { runtime, chromeApi, requests };
}

function createClient(runtime, chromeApi) {
  return {
    restoreSession: () => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.AUTH_RESTORE_SESSION });
      return runtime.dispatch({ type: MESSAGE_NAMES.AUTH_RESTORE_SESSION }, { tab: { windowId: 1 } });
    },
    getAuthState: () => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.AUTH_GET_STATE });
      return runtime.dispatch({ type: MESSAGE_NAMES.AUTH_GET_STATE }, { tab: { windowId: 1 } });
    },
    getBootstrapState: () => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.BOOTSTRAP_GET_STATE });
      return runtime.dispatch({ type: MESSAGE_NAMES.BOOTSTRAP_GET_STATE }, { tab: { windowId: 1 } });
    },
    listCitations: (payload) => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.SIDEPANEL_LIST_CITATIONS, payload });
      return runtime.dispatch({ type: MESSAGE_NAMES.SIDEPANEL_LIST_CITATIONS, payload }, { tab: { windowId: 1 } });
    },
    listNotes: (payload) => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.SIDEPANEL_LIST_NOTES, payload });
      return runtime.dispatch({ type: MESSAGE_NAMES.SIDEPANEL_LIST_NOTES, payload }, { tab: { windowId: 1 } });
    },
    openEditor: () => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR });
      return runtime.dispatch({ type: MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR }, { tab: { windowId: 1 } });
    },
    openDashboard: () => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD });
      return runtime.dispatch({ type: MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD }, { tab: { windowId: 1 } });
    },
    signOut: () => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.AUTH_SIGN_OUT });
      return runtime.dispatch({ type: MESSAGE_NAMES.AUTH_SIGN_OUT }, { tab: { windowId: 1 } });
    },
    createNote: (payload) => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.CAPTURE_CREATE_NOTE, payload });
      return runtime.dispatch({ type: MESSAGE_NAMES.CAPTURE_CREATE_NOTE, payload }, { tab: { windowId: 1 } });
    },
    saveCitationState: (payload) => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.CITATION_SAVE_STATE, payload });
      return runtime.dispatch({ type: MESSAGE_NAMES.CITATION_SAVE_STATE, payload }, { tab: { windowId: 1 } });
    },
    renderCitation: (payload) => {
      chromeApi.messages.push({ type: MESSAGE_NAMES.CITATION_RENDER, payload });
      return runtime.dispatch({ type: MESSAGE_NAMES.CITATION_RENDER, payload }, { tab: { windowId: 1 } });
    },
  };
}

test("signed-out sidepanel stays background-only and does not fetch lists", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  globalThis.document = documentRef;
  globalThis.window = new FakeEventTarget();
  let shell;
  try {
    const { chromeApi, runtime, requests } = createRuntime({ signedIn: false });
    const root = documentRef.createElement("div");
    shell = createSidepanelShell({
      root,
      client: createClient(runtime, chromeApi),
      chromeApi,
      documentRef,
      navigatorRef: { clipboard: { async writeText() {} } },
    });
    shell.render();
    await shell.refresh();

    assert.equal(shell.getState().status, "signed_out");
    assert.equal(collectText(root.shadowRoot || root).includes("Signed out"), true);
    assert.equal(requests.some((entry) => entry.url.includes("/api/citations?")), false);
    assert.equal(requests.some((entry) => entry.url.includes("/api/notes?")), false);
    assert.equal(chromeApi.messages.some((message) => message.type === MESSAGE_NAMES.AUTH_RESTORE_SESSION), true);
    assert.equal(runtime.stateStore.getState().status, "signed_out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("signed-in sidepanel loads recent items, supports expand/copy, and keeps navigation in background", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  globalThis.document = documentRef;
  globalThis.window = new FakeEventTarget();
  let shell;
  try {
    const { chromeApi, runtime, requests } = createRuntime({
      signedIn: true,
      citationsBody: {
        ok: true,
        data: [
          {
            id: "citation-1",
            source_id: "source-1",
            source: { title: "Source Title", hostname: "example.com" },
            excerpt: "Selected excerpt",
            quote_text: "Selected excerpt",
            renders: {
              apa: {
                inline: "(Author, 2024)",
                bibliography: "Author. (2024). Source Title.",
                footnote: "Author. Source Title.",
              },
            },
            style: "apa",
            format: "bibliography",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
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
    const clipboard = { lastText: "", async writeText(text) { this.lastText = text; } };
    const root = documentRef.createElement("div");
    shell = createSidepanelShell({
      root,
      client: createClient(runtime, chromeApi),
      chromeApi,
      documentRef,
      navigatorRef: { clipboard },
    });
    shell.render();
    await shell.refresh();

    const mountedRoot = root.shadowRoot || root;
    assert.equal(shell.getState().status, "ready");
    assert.equal(chromeApi.messages.some((message) => message.type === MESSAGE_NAMES.AUTH_RESTORE_SESSION), true);
    assert.equal(requests.some((entry) => entry.url.includes("/api/citations?limit=8")), true);
    assert.equal(requests.some((entry) => entry.url.includes("/api/notes?limit=8")), true);
    assert.equal(collectText(mountedRoot).includes("Source Title"), true);

    const citationRow = findByAttr(mountedRoot, "data-citation-id", "citation-1");
    assert.ok(citationRow);
    const citationCopy = findByText(citationRow, "Copy");
    citationCopy.dispatchEvent(new FakeEvent("click", citationCopy));
    assert.equal(clipboard.lastText.includes("Author. (2024). Source Title."), true);

    const citationExpand = findByText(citationRow, "Expand");
    citationExpand.dispatchEvent(new FakeEvent("click", citationExpand));
    assert.equal(shell.getState().expanded_citation_id, "citation-1");

    const notesTab = findByAttr(mountedRoot, "data-tab", "notes");
    notesTab.dispatchEvent(new FakeEvent("click", notesTab));
    assert.equal(shell.getState().active_tab, "notes");
    assert.equal(collectText(mountedRoot).includes("Field note"), true);

    const profileCard = findByAttr(mountedRoot, "data-profile-card", "true");
    const actionButtons = profileCard.children[1].children;
    const openEditor = actionButtons.find((child) => child.textContent === "Open editor");
    const openDashboard = actionButtons.find((child) => child.textContent === "Open dashboard");
    const signOut = actionButtons.find((child) => child.textContent === "Sign out");

    openEditor.dispatchEvent(new FakeEvent("click", openEditor));
    openDashboard.dispatchEvent(new FakeEvent("click", openDashboard));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chromeApi.tabsCreateCalls[0].url, "https://app.writior.com/editor");
    assert.equal(chromeApi.tabsCreateCalls[1].url, "https://app.writior.com/dashboard");

    signOut.dispatchEvent(new FakeEvent("click", signOut));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(shell.getState().status, "signed_out");
    assert.equal(chromeApi.messages.some((message) => message.type === MESSAGE_NAMES.AUTH_SIGN_OUT), true);
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
