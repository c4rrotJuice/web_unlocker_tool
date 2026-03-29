import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { createRuntimeClient } from "../extension/shared/utils/runtime_client.js";
import { bootstrapPopup } from "../extension/popup/main.js";
import { createSidepanelLauncher } from "../extension/content/ui/sidepanel_launcher.js";
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

  attachShadow() {
    if (!this.shadowRoot) {
      this.shadowRoot = new FakeElement("#shadow-root", this.ownerDocument);
    }
    return this.shadowRoot;
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

  getElementById(id) {
    return findByAttr(this.documentElement, "id", id);
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
          capabilities: {
            citation_styles: ["apa", "mla", "chicago", "harvard"],
            unlocks: true,
            documents: {},
            usage: {
              docs: "3/7",
              cites: "11/25",
              quotes: "4/10",
              notes: "2/8",
            },
          },
          app: {
            origin: "https://app.writior.com",
            handoff: { preferred_destination: "/editor/from-bootstrap" },
            routes: { dashboard_path: "/dashboard/from-bootstrap" },
          },
          taxonomy: {
            recent_projects: [{ id: "project-1", name: "Project Atlas" }],
            recent_tags: [{ id: "tag-1", name: "evidence" }],
          },
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
    if (normalizedUrl.endsWith("/api/extension/captures/note")) {
      return createResponse({ ok: true, data: { id: "note-2" } });
    }
    return createResponse({ ok: false, error: { code: "unexpected", message: normalizedUrl } }, 404);
  };
  return { fetchImpl, requests };
}

function createChromeStub(initialStorage = {}) {
  const storage = { ...initialStorage };
  const messages = [];
  const tabsCreateCalls = [];
  const sidePanelOpenCalls = [];
  const sidePanelCloseCalls = [];
  const sidePanelSetOptionsCalls = [];
  const storageListeners = [];
  const listeners = {
    actionClicked: null,
    sidePanelOpened: null,
    sidePanelClosed: null,
  };
  function emitStorageChange(changes) {
    for (const listener of storageListeners) {
      listener(changes, "local");
    }
  }
  const chromeApi = {
    messages,
    tabsCreateCalls,
    sidePanelOpenCalls,
    sidePanelCloseCalls,
    sidePanelSetOptionsCalls,
    listeners,
    _dispatch: null,
    action: {
      onClicked: {
        addListener(listener) {
          listeners.actionClicked = listener;
        },
      },
    },
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
      async query() {
        return [{ id: 11, title: "Example page", url: "https://example.com/page", windowId: 1 }];
      },
    },
    sidePanel: {
      async open(args) {
        sidePanelOpenCalls.push(args);
        listeners.sidePanelOpened?.(args);
        return args;
      },
      async close(args) {
        sidePanelCloseCalls.push(args);
        listeners.sidePanelClosed?.(args);
        return args;
      },
      async setOptions(args) {
        sidePanelSetOptionsCalls.push(args);
        return args;
      },
      onOpened: {
        addListener(listener) {
          listeners.sidePanelOpened = listener;
        },
      },
      onClosed: {
        addListener(listener) {
          listeners.sidePanelClosed = listener;
        },
      },
    },
    storage: {
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
        removeListener(listener) {
          const index = storageListeners.indexOf(listener);
          if (index >= 0) {
            storageListeners.splice(index, 1);
          }
        },
      },
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: storage[key], newValue: value };
          }
          Object.assign(storage, values);
          emitStorageChange(changes);
        },
        async remove(key) {
          const keys = Array.isArray(key) ? key : [key];
          const changes = {};
          for (const entry of keys) {
            changes[entry] = { oldValue: storage[entry], newValue: undefined };
            delete storage[entry];
          }
          emitStorageChange(changes);
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
    openSidepanel: (payload = {}) => runtime.dispatch({
      type: MESSAGE_NAMES.OPEN_SIDEPANEL,
      requestId: "open-sidepanel",
      payload: { surface: "sidepanel", ...payload },
    }, { tab: { id: 11, windowId: 1 } }),
    bootstrapFetch: () => runtime.dispatch({
      type: MESSAGE_NAMES.BOOTSTRAP_FETCH,
      requestId: "bootstrap-fetch",
      payload: { surface: "sidepanel" },
    }, { tab: { windowId: 1 } }),
    authStatusGet: () => runtime.dispatch({
      type: MESSAGE_NAMES.AUTH_STATUS_GET,
      requestId: "auth-status",
      payload: { surface: "sidepanel" },
    }, { tab: { windowId: 1 } }),
    authLogout: () => runtime.dispatch({
      type: MESSAGE_NAMES.AUTH_LOGOUT,
      requestId: "auth-logout",
      payload: { surface: "sidepanel" },
    }, { tab: { windowId: 1 } }),
    listRecentCitations: (payload = {}) => runtime.dispatch({
      type: MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_CITATIONS,
      requestId: "list-citations",
      payload: { surface: "sidepanel", ...payload },
    }, { tab: { windowId: 1 } }),
    listRecentNotes: (payload = {}) => runtime.dispatch({
      type: MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_NOTES,
      requestId: "list-notes",
      payload: { surface: "sidepanel", ...payload },
    }, { tab: { windowId: 1 } }),
    openEditor: () => runtime.dispatch({
      type: MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR,
      requestId: "open-editor",
      payload: { surface: "sidepanel" },
    }, { tab: { windowId: 1 } }),
    openDashboard: () => runtime.dispatch({
      type: MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD,
      requestId: "open-dashboard",
      payload: { surface: "sidepanel" },
    }, { tab: { windowId: 1 } }),
    createNote: (payload) => runtime.dispatch({
      type: MESSAGE_NAMES.CAPTURE_CREATE_NOTE,
      requestId: "create-note",
      payload: { surface: "sidepanel", ...payload },
    }, { tab: { windowId: 1 } }),
    renderCitation: (payload) => runtime.dispatch({
      type: MESSAGE_NAMES.CITATION_RENDER,
      requestId: "render-citation",
      payload: { surface: "sidepanel", ...payload },
    }, { tab: { windowId: 1 } }),
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

    const mountedRoot = root.shadowRoot || root;
    const actionRow = findByAttr(mountedRoot, "data-action-row", "true");
    const signIn = actionRow.children.find((child) => child.textContent === "Sign In");
    const signOut = actionRow.children.find((child) => child.textContent === "Sign Out");
    const sidepanelLogo = findByAttr(mountedRoot, "data-writior-logo", "true");
    assert.equal(shell.getState().status, "signed_out");
    assert.equal(collectText(mountedRoot).includes("Not signed in"), true);
    assert.ok(sidepanelLogo);
    assert.equal(sidepanelLogo.getAttribute("data-logo-size"), "32");
    assert.equal(sidepanelLogo.src, "../assets/icons/writior_logo_32.jpg");
    assert.ok(signIn);
    assert.equal(Boolean(signOut), false);
    assert.equal(requests.some((entry) => entry.url.includes("/api/citations?")), false);
    assert.equal(requests.some((entry) => entry.url.includes("/api/notes?")), false);
    assert.ok(findByAttr(mountedRoot, "data-tab", "docs"));
    assert.ok(findByAttr(mountedRoot, "data-gated-state", "true"));
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("sidepanel runtime client omits blank query values from list requests", async () => {
  let capturedMessage = null;
  const chromeApi = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        capturedMessage = message;
        callback?.({ ok: true, status: "ok", requestId: message.requestId, data: { items: [] } });
      },
    },
  };
  const client = createRuntimeClient(chromeApi, "sidepanel");
  await client.listRecentCitations({ limit: 8, offset: 0, query: "" });
  assert.ok(capturedMessage);
  assert.equal(Object.prototype.hasOwnProperty.call(capturedMessage.payload, "query"), false);
});

test("signed-in sidepanel loads compact workspace lists, tabs, hover preview, and background navigation", async () => {
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
            project: { id: "project-1", name: "Project Atlas" },
            note_ids: ["note-1"],
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
            project: { id: "project-1", name: "Project Atlas" },
            tags: [{ id: "tag-1", name: "evidence" }, { id: "tag-2", name: "draft" }],
            evidence_links: [{ id: "link-1", evidence_role: "primary" }],
            relationship_groups: { evidence_links_by_role: { primary: [{ id: "link-1" }] } },
            lineage: { citation_id: "citation-1", quote_id: null },
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
    assert.equal(requests.some((entry) => entry.url.includes("/api/citations?limit=8")), true);
    assert.equal(requests.some((entry) => entry.url.includes("/api/notes?limit=8")), false);
    assert.equal(collectText(mountedRoot).includes("Source Title"), true);
    assert.equal(collectText(mountedRoot).includes("1 note"), true);
    assert.equal(collectText(mountedRoot).includes("Researcher"), true);
    assert.equal(collectText(mountedRoot).includes("Pro"), true);
    const sidepanelLogo = findByAttr(mountedRoot, "data-writior-logo", "true");
    assert.ok(sidepanelLogo);
    assert.equal(sidepanelLogo.getAttribute("data-logo-size"), "32");
    assert.equal(sidepanelLogo.src, "../assets/icons/writior_logo_32.jpg");
    assert.equal(findByAttr(mountedRoot, "data-usage-gauge-row", "true").style.display, "grid");
    assert.equal(findByAttr(mountedRoot, "data-list-scroll", "true").style.overflow, "auto");

    const citationRow = findByAttr(mountedRoot, "data-citation-id", "citation-1");
    assert.ok(citationRow);
    citationRow.dispatchEvent(new FakeEvent("mouseenter", citationRow));
    assert.equal(collectText(mountedRoot).includes("Author. (2024). Source Title."), true);
    citationRow.dispatchEvent(new FakeEvent("click", citationRow));
    const formatSelect = findByAttr(mountedRoot, "data-citation-preview-format", "true");
    assert.ok(formatSelect);
    formatSelect.value = "footnote";
    formatSelect.dispatchEvent(new FakeEvent("change", formatSelect));
    const copyButton = findByAttr(mountedRoot, "data-citation-preview-copy", "true");
    assert.ok(copyButton);
    copyButton.dispatchEvent(new FakeEvent("click", copyButton));
    assert.equal(clipboard.lastText.includes("Author. Source Title."), true);

    const notesTab = findByAttr(mountedRoot, "data-tab", "notes");
    notesTab.dispatchEvent(new FakeEvent("click", notesTab));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(shell.getState().active_tab, "notes");
    assert.equal(requests.some((entry) => entry.url.includes("/api/notes?limit=8")), true);
    assert.equal(collectText(mountedRoot).includes("Field note"), true);
    assert.equal(collectText(mountedRoot).includes("From citation"), true);
    assert.equal(collectText(mountedRoot).includes("Project Project Atlas"), true);
    assert.equal(collectText(mountedRoot).includes("2 tags"), true);

    const noteRow = findByAttr(mountedRoot, "data-note-id", "note-1");
    noteRow.dispatchEvent(new FakeEvent("mouseenter", noteRow));
    noteRow.dispatchEvent(new FakeEvent("click", noteRow));
    assert.equal(clipboard.lastText.includes("Note body text"), true);

    const actionRow = findByAttr(mountedRoot, "data-action-row", "true");
    const openEditor = actionRow.children.find((child) => child.textContent === "Open Editor");
    const openDashboard = actionRow.children.find((child) => child.textContent === "Dashboard");
    const signOut = actionRow.children.find((child) => child.textContent === "Sign Out");
    assert.ok(signOut);

    openEditor.dispatchEvent(new FakeEvent("click", openEditor));
    openDashboard.dispatchEvent(new FakeEvent("click", openDashboard));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(chromeApi.tabsCreateCalls[0].url, "https://app.writior.com/editor/from-bootstrap");
    assert.equal(chromeApi.tabsCreateCalls[1].url, "https://app.writior.com/dashboard/from-bootstrap");
    assert.equal(collectText(mountedRoot).includes("Opening dashboard..."), true);

    signOut.dispatchEvent(new FakeEvent("click", signOut));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(shell.getState().status, "signed_out");
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("new note composer exposes project and tag capture context without graph authoring controls", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  globalThis.document = documentRef;
  globalThis.window = new FakeEventTarget();
  let shell;
  try {
    const { chromeApi, runtime } = createRuntime({ signedIn: true });
    const createCalls = [];
    const root = documentRef.createElement("div");
    shell = createSidepanelShell({
      root,
      client: {
        ...createClient(runtime, chromeApi),
        createNote: async (payload) => {
          createCalls.push(payload);
          return { ok: true, data: { id: "note-created" } };
        },
      },
      chromeApi,
      documentRef,
      navigatorRef: { clipboard: { async writeText() {} } },
    });
    await shell.refresh();

    const mountedRoot = root.shadowRoot || root;
    const newNoteTab = findByAttr(mountedRoot, "data-tab", "new-note");
    newNoteTab.dispatchEvent(new FakeEvent("click", newNoteTab));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const openButton = findByAttr(mountedRoot, "data-note-open", "true");
    openButton.dispatchEvent(new FakeEvent("click", openButton));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const projectSelect = findByAttr(mountedRoot, "data-note-project-select", "true");
    assert.ok(projectSelect);
    projectSelect.value = "project-1";
    projectSelect.dispatchEvent(new FakeEvent("change", projectSelect));

    const tagButton = findByAttr(mountedRoot, "data-note-tag", "tag-1");
    assert.ok(tagButton);
    tagButton.dispatchEvent(new FakeEvent("click", tagButton));

    assert.equal(findByAttr(mountedRoot, "data-note-evidence-role", "true"), null);
    assert.equal(findByAttr(mountedRoot, "data-note-link-authoring", "true"), null);

    const textarea = findByAttr(mountedRoot, "data-note-text", "true");
    textarea.value = "Contextual note";
    textarea.dispatchEvent(new FakeEvent("input", textarea));

    const saveButton = findByAttr(mountedRoot, "data-note-save", "true");
    saveButton.dispatchEvent(new FakeEvent("click", saveButton));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].projectId, "project-1");
    assert.deepEqual(createCalls[0].tagIds, ["tag-1"]);
    assert.equal(createCalls[0].evidenceRole, "primary");
    assert.equal(collectText(mountedRoot).includes("Open in Editor to Link related notes or Convert quotes."), true);
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("sidepanel surfaces launch failures when canonical dashboard truth is unavailable", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  globalThis.document = documentRef;
  globalThis.window = new FakeEventTarget();
  let shell;
  try {
    const { chromeApi, runtime } = createRuntime({ signedIn: true });
    runtime.stateStore.setSignedIn({
      session: {
        access_token: "token-1",
        token_type: "bearer",
        user_id: "user-1",
        email: "user@example.com",
        source: "background",
      },
      bootstrap: {
        profile: { id: "user-1", display_name: "Researcher", email: "user@example.com" },
        entitlement: { tier: "pro", status: "active" },
        capabilities: { citation_styles: ["apa"], unlocks: true, documents: {} },
        app: { origin: "https://app.writior.com", handoff: { preferred_destination: "/editor" } },
        taxonomy: { recent_projects: [], recent_tags: [] },
      },
    });
    const root = documentRef.createElement("div");
    shell = createSidepanelShell({
      root,
      client: createClient(runtime, chromeApi),
      chromeApi,
      documentRef,
      navigatorRef: { clipboard: { async writeText() {} } },
    });
    shell.render();

    const mountedRoot = root.shadowRoot || root;
    const actionRow = findByAttr(mountedRoot, "data-action-row", "true");
    const openDashboard = actionRow.children.find((child) => child.textContent === "Dashboard");
    openDashboard.dispatchEvent(new FakeEvent("click", openDashboard));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(chromeApi.tabsCreateCalls.length, 1);
    assert.equal(chromeApi.tabsCreateCalls[0].url, "https://app.writior.com/dashboard");
    assert.equal(collectText(mountedRoot).includes("Opening dashboard..."), true);
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test("background-owned sidepanel toggle can open and close without relying on the pinned toolbar icon", async () => {
  const { chromeApi, runtime } = createRuntime({ signedIn: true });
  const client = createClient(runtime, chromeApi);

  const openResult = await client.openSidepanel({ mode: "toggle" });
  const closeResult = await client.openSidepanel({ mode: "toggle" });

  assert.equal(openResult.ok, true);
  assert.equal(openResult.data.opened, true);
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.data.opened, false);
  assert.equal(chromeApi.sidePanelOpenCalls.length, 1);
  assert.equal(chromeApi.sidePanelCloseCalls.length, 1);
  assert.equal(chromeApi.sidePanelSetOptionsCalls[0].enabled, true);
});

test("toolbar action click registers once and uses the same background sidepanel toggle path", async () => {
  const { chromeApi, runtime } = createRuntime({ signedIn: true });

  assert.equal(runtime.registerLifecycleHooks(), true);
  assert.equal(typeof chromeApi.listeners.actionClicked, "function");

  await chromeApi.listeners.actionClicked({ id: 11, windowId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await chromeApi.listeners.actionClicked({ id: 11, windowId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(chromeApi.sidePanelOpenCalls.length, 1);
  assert.equal(chromeApi.sidePanelCloseCalls.length, 1);
  assert.deepEqual(chromeApi.sidePanelOpenCalls[0], { tabId: 11 });
  assert.deepEqual(chromeApi.sidePanelCloseCalls[0], { tabId: 11 });
});

test("sidepanel toggle restores persisted open state after worker restart instead of reopening stale panels", async () => {
  const seededState = {
    "tab:11": true,
  };
  const chromeApi = createChromeStub({
    writior_auth_session: {
      access_token: "token-1",
      token_type: "bearer",
      user_id: "user-1",
      email: "user@example.com",
      source: "background",
    },
    "writior.sidepanel_state": seededState,
  });
  const { fetchImpl } = createFetchStub({ signedIn: true });
  const runtime = createBackgroundRuntime({
    chromeApi,
    fetchImpl,
    baseUrl: "https://app.writior.com",
  });

  const result = await runtime.dispatch({
    type: MESSAGE_NAMES.OPEN_SIDEPANEL,
    requestId: "toggle-after-restart",
    payload: { surface: "content", mode: "toggle" },
  }, { tab: { id: 11, windowId: 1 } });

  assert.equal(result.ok, true);
  assert.equal(result.data.opened, false);
  assert.equal(chromeApi.sidePanelOpenCalls.length, 0);
  assert.equal(chromeApi.sidePanelCloseCalls.length, 1);
});

test("popup launcher button sends the canonical sidepanel toggle request and stays lightweight", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousChrome = globalThis.chrome;
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  root.setAttribute("id", "app");
  documentRef.body.appendChild(root);
  let closeCount = 0;
  const sentMessages = [];

  globalThis.document = documentRef;
  globalThis.window = {
    close() {
      closeCount += 1;
    },
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      sendMessage(message, callback) {
        sentMessages.push(message);
        if (message.type === MESSAGE_NAMES.AUTH_STATUS_GET) {
          callback?.({
            ok: true,
            status: "ok",
            requestId: message.requestId,
            data: { auth: { status: "signed_out" } },
          });
          return;
        }
        callback?.({
          ok: true,
          status: "ok",
          requestId: message.requestId,
          data: { opened: true, target: "sender_tab" },
        });
      },
    },
    storage: {
      onChanged: {
        addListener() {},
      },
    },
  };

  try {
    bootstrapPopup();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const button = findByText(root, "Toggle Workspace");
    assert.ok(button);
    const popupLogo = findByAttr(root, "data-writior-logo", "true");
    assert.ok(popupLogo);
    assert.equal(popupLogo.getAttribute("data-logo-size"), "48");
    assert.equal(popupLogo.src, "chrome-extension://test/assets/icons/writior_logo_48.jpg");
    button.dispatchEvent(new FakeEvent("click", button));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toggleMessage = sentMessages.find((message) => message.type === MESSAGE_NAMES.OPEN_SIDEPANEL);
    assert.ok(toggleMessage);
    assert.equal(toggleMessage.payload.surface, "popup");
    assert.equal(toggleMessage.payload.mode, "toggle");
    assert.equal(collectText(root).includes("Writior"), true);
    assert.equal(closeCount, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.chrome = previousChrome;
  }
});

test("page icon surfaces sidepanel toggle failures instead of failing silently", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousChrome = globalThis.chrome;
  const documentRef = new FakeDocument();
  const timers = [];
  const windowRef = {
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
    clearTimeout() {},
  };
  globalThis.document = documentRef;
  globalThis.window = windowRef;
  globalThis.chrome = {
    runtime: {
      lastError: null,
    },
  };

  try {
    const launcher = createSidepanelLauncher({
      documentRef,
      windowRef,
      chromeApi: globalThis.chrome,
      runtimeClient: {
        async openSidepanel() {
          return {
            ok: false,
            status: "error",
            error: {
              code: "not_implemented",
              message: "Workspace toggle failed.",
            },
          };
        },
      },
    });
    launcher.mount();
    const button = findByAttr(documentRef.body, "aria-label", "Toggle Writior sidepanel");
    assert.ok(button);

    button.dispatchEvent(new FakeEvent("click", button));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(collectText(documentRef.body).includes("Workspace toggle failed."), true);
    timers.splice(0).forEach((handler) => handler());
    launcher.destroy();
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.chrome = previousChrome;
  }
});

test("popup auth actions follow canonical auth-state storage updates without stale sign-in UI", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousChrome = globalThis.chrome;
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  root.setAttribute("id", "app");
  documentRef.body.appendChild(root);
  let storageListener = null;

  globalThis.document = documentRef;
  globalThis.window = { close() {} };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback?.({
          ok: true,
          status: "ok",
          requestId: message.requestId,
          data: {
            auth: {
              status: "signed_in",
              session: { access_token: "token-1", email: "user@example.com" },
              bootstrap: { profile: { display_name: "Researcher" } },
            },
          },
        });
      },
    },
    storage: {
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
  };

  try {
    bootstrapPopup();
    await new Promise((resolve) => setTimeout(resolve, 0));

    let signOutButton = findByText(root, "Sign Out");
    let signInButton = findByText(root, "Sign In");
    assert.ok(signOutButton);
    assert.equal(signOutButton.style.display || "", "");
    assert.ok(signInButton);
    assert.equal(signInButton.style.display, "none");

    storageListener?.({
      "writior.auth_state": {
        oldValue: { status: "signed_in", session: { access_token: "token-1" } },
        newValue: { status: "signed_out", reason: "refresh_failed", session: null, bootstrap: null, error: null },
      },
    }, "local");

    signOutButton = findByText(root, "Sign Out");
    signInButton = findByText(root, "Sign In");
    assert.ok(signInButton);
    assert.equal(signOutButton.style.display, "none");
    assert.equal(signInButton.style.display || "", "");
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.chrome = previousChrome;
  }
});

test("sidepanel reacts to canonical auth-state changes and clears stale signed-in workspace UI", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const documentRef = new FakeDocument();
  globalThis.document = documentRef;
  globalThis.window = new FakeEventTarget();
  let storageListener = null;
  let authState = {
    status: "signed_in",
    session: { access_token: "token-1", email: "user@example.com" },
    bootstrap: {
      profile: { display_name: "Researcher", email: "user@example.com" },
      entitlement: { tier: "pro", status: "active" },
      capabilities: { citation_styles: ["apa"], unlocks: true, documents: {} },
      app: { origin: "https://app.writior.com", handoff: { preferred_destination: "/editor" } },
      taxonomy: { recent_projects: [], recent_tags: [] },
    },
  };
  const chromeApi = {
    tabs: {
      async query() {
        return [{ id: 11, title: "Example page", url: "https://example.com/page", windowId: 1 }];
      },
    },
    storage: {
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
        removeListener() {},
      },
    },
  };
  const client = {
    async authStatusGet() {
      return { ok: true, data: { auth: authState } };
    },
    async listRecentCitations() {
      return { ok: true, data: { items: [] } };
    },
    async listRecentNotes() {
      return { ok: true, data: { items: [] } };
    },
    async openEditor() {
      return { ok: true };
    },
    async openDashboard() {
      return { ok: true };
    },
    async authStart() {
      return { ok: true, data: { auth: authState } };
    },
    async authLogout() {
      return { ok: true, data: { auth: { status: "signed_out" } } };
    },
  };
  let shell;

  try {
    const root = documentRef.createElement("div");
    shell = createSidepanelShell({
      root,
      client,
      chromeApi,
      documentRef,
      navigatorRef: { clipboard: { async writeText() {} } },
    });
    shell.render();
    await shell.refresh();

    let mountedRoot = root.shadowRoot || root;
    let actionRow = findByAttr(mountedRoot, "data-action-row", "true");
    let authButton = actionRow.children.find((child) => child.textContent === "Sign Out");
    assert.ok(authButton);

    authState = { status: "signed_out", reason: "refresh_failed", session: null, bootstrap: null, error: null };
    storageListener?.({
      "writior.auth_state": {
        oldValue: { status: "signed_in", session: { access_token: "token-1" } },
        newValue: authState,
      },
    }, "local");

    mountedRoot = root.shadowRoot || root;
    actionRow = findByAttr(mountedRoot, "data-action-row", "true");
    authButton = actionRow.children.find((child) => child.textContent === "Sign In");
    assert.ok(authButton);
    assert.equal(shell.getState().status, "signed_out");
  } finally {
    shell?.destroy?.();
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
