import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

import { createWorkspaceApi } from "../../app/static/js/editor_v2/api/workspace_api.js";
import { createWorkspaceState } from "../../app/static/js/editor_v2/core/workspace_state.js";
import { createResearchHydrator } from "../../app/static/js/editor_v2/research/research_hydrator.js";
import { createSourceStore } from "../../app/static/js/editor_v2/research/source_store.js";
import { createCitationStore } from "../../app/static/js/editor_v2/research/citation_store.js";
import { createQuoteStore } from "../../app/static/js/editor_v2/research/quote_store.js";
import { createNoteStore } from "../../app/static/js/editor_v2/research/note_store.js";
import { createOutlineController } from "../../app/static/js/editor_v2/document/outline_controller.js";
import { createDocumentController } from "../../app/static/js/editor_v2/document/document_controller.js";
import { createAutosaveController } from "../../app/static/js/editor_v2/document/autosave_controller.js";
import { composeEditorDelta, normalizeEditorDelta, sanitizeEditorHtml } from "../../app/static/js/editor_v2/ui/quill_adapter.js";
import { createAttachActions } from "../../app/static/js/editor_v2/actions/attach_actions.js";
import { createLinkActions } from "../../app/static/js/editor_v2/actions/link_actions.js";
import { createConvertActions } from "../../app/static/js/editor_v2/actions/convert_actions.js";
import { renderContextRail } from "../../app/static/js/editor_v2/ui/context_rail_renderer.js";
import { createExplorerController } from "../../app/static/js/editor_v2/research/explorer_controller.js";
import { createCheckpointController } from "../../app/static/js/editor_v2/document/checkpoint_controller.js";
import { createNoteActions } from "../../app/static/js/editor_v2/actions/note_actions.js";
import { renderExplorerList } from "../../app/static/js/editor_v2/ui/explorer_renderer.js";
import { createAuthSessionError, createAuthSessionErrorFromPayload, isAuthSessionError } from "../../app/static/js/shared/auth/session.js";
import { FEEDBACK_EVENTS } from "../../app/static/js/shared/feedback/feedback_tokens.js";
import { initSidebarShell } from "../../app/static/js/app_shell/core/sidebar.js";
import { citationDisplayTitle, citationPrimaryText, citationRenderEntries } from "../../app/static/js/shared/citation_contract.js";

function okResponse(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, data, meta: {}, error: null };
    },
  };
}

function installWindow(overrides = {}) {
  const window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener() {},
    removeEventListener() {},
    location: { pathname: "/", search: "" },
    ...overrides,
  };
  if (window.webUnlockerAuth && typeof window.webUnlockerAuth.authJson !== "function" && typeof window.webUnlockerAuth.authFetch === "function") {
    window.webUnlockerAuth.authJson = async function (path, options = {}, { unwrapEnvelope = true } = {}) {
      const res = await window.webUnlockerAuth.authFetch(path, options);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error(payload?.detail || payload?.error?.message || "Request failed");
        error.status = res.status;
        error.payload = payload;
        throw error;
      }
      if (unwrapEnvelope && payload && typeof payload === "object" && "ok" in payload && "data" in payload) {
        return payload.data;
      }
      return payload;
    };
  }
  globalThis.window = window;
  return globalThis.window;
}

function loadAuthRuntime({ client, fetchImpl, createClientHook = null }) {
  const listeners = new Map();
  const documentListeners = new Map();
  const window = {
    WRITIOR_SUPABASE_URL: "https://supabase.example.test",
    WRITIOR_SUPABASE_ANON_KEY: "anon-key",
    supabase: {
      createClient() {
        createClientHook?.();
        return client;
      },
    },
    fetch: fetchImpl,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    dispatchEvent(event) {
      const entries = listeners.get(event?.type) || [];
      for (const listener of entries) {
        listener(event);
      }
    },
    location: {
      pathname: "/editor",
      search: "?document_id=doc-1",
      href: "http://example.test/editor?document_id=doc-1",
    },
  };
  const document = {
    hidden: false,
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || [];
      entries.push(listener);
      documentListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = documentListeners.get(type) || [];
      documentListeners.set(type, entries.filter((entry) => entry !== listener));
    },
  };
  const context = {
    window,
    document,
    fetch: fetchImpl,
    Headers: globalThis.Headers,
    Error,
    console,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    URLSearchParams,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync("app/static/js/auth.js", "utf8"), context, { filename: "app/static/js/auth.js" });
  return {
    window: context.window,
    document,
    emitWindow(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
    emitDocument(type, event = {}) {
      for (const listener of documentListeners.get(type) || []) {
        listener(event);
      }
    },
  };
}

function loadThemeRuntime({
  authJson,
  onAuthStateChange,
  readyState = "complete",
  localStorageSeed = {},
  themeToggle = makeElement(),
  matchMediaMatches = false,
} = {}) {
  const listeners = new Map();
  const storage = new Map(Object.entries(localStorageSeed));
  const documentElement = {
    dataset: {},
    style: {},
    classList: {
      toggle() {},
    },
  };
  const document = {
    readyState,
    documentElement,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    getElementById(id) {
      if (id === "themeToggle") return themeToggle;
      return null;
    },
  };
  const window = {
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    matchMedia() {
      return {
        matches: matchMediaMatches,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      };
    },
    webUnlockerAuth: {
      authJson,
      onAuthStateChange,
      isAuthSessionError() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    document,
    console,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  const context = {
    window,
    document,
    console,
    Error,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    URLSearchParams,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync("app/static/js/theme.js", "utf8"), context, { filename: "app/static/js/theme.js" });
  return {
    window: context.window,
    document,
    themeToggle,
    storage,
    emitDOMContentLoaded() {
      for (const listener of listeners.get("DOMContentLoaded") || []) {
        listener({ type: "DOMContentLoaded" });
      }
    },
  };
}

test("citation contract helpers prefer canonical render bundle shape", () => {
  const citation = {
    source: { title: "Ignored title" },
    render_bundle: {
      renders: {
        chicago: {
          inline: "(Doe 2024)",
          bibliography: "Doe, Jane. Example Source.",
          footnote: "Jane Doe, Example Source.",
          quote_attribution: "\"Quoted sentence\" (Doe 2024)",
        },
      },
      styles: [
        {
          style: "chicago",
          kinds: ["bibliography", "footnote", "quote_attribution", "inline"],
          texts: {
            inline: "(Doe 2024)",
            bibliography: "Doe, Jane. Example Source.",
            footnote: "Jane Doe, Example Source.",
            quote_attribution: "\"Quoted sentence\" (Doe 2024)",
          },
        },
      ],
      primary: {
        style: "chicago",
        kind: "bibliography",
        text: "Doe, Jane. Example Source.",
      },
    },
  };

  assert.equal(citationPrimaryText(citation), "Doe, Jane. Example Source.");
  assert.equal(citationDisplayTitle(citation), "Ignored title");
  assert.deepEqual(citationRenderEntries(citation), [
    { style: "chicago", kind: "bibliography", text: "Doe, Jane. Example Source." },
    { style: "chicago", kind: "footnote", text: "Jane Doe, Example Source." },
    { style: "chicago", kind: "quote_attribution", text: "\"Quoted sentence\" (Doe 2024)" },
    { style: "chicago", kind: "inline", text: "(Doe 2024)" },
  ]);
});

function createSidebarDom() {
  const shell = makeElement();
  shell.dataset = {};
  const sidebar = makeElement();
  const sidebarToggle = makeElement();
  const sidebarAutoHideToggle = makeElement();
  const mobileToggle = makeElement();
  const backdrop = makeElement();
  const body = makeElement();
  const documentElement = { dataset: {} };
  const navLink = makeElement({ getAttribute() { return null; } });
  sidebar.querySelectorAll = () => [navLink];
  return {
    shell,
    sidebar,
    sidebarToggle,
    sidebarAutoHideToggle,
    mobileToggle,
    backdrop,
    body,
    documentElement,
  };
}

function loadNavRuntime({ auth, ui } = {}) {
  const listeners = new Map();
  const navLinks = makeElement({ appendChild() {} });
  const authButton = makeElement();
  const dashboardLink = makeElement();
  const editorLink = makeElement();
  const elements = {
    authButton,
    dashboardLink,
    editorLink,
  };
  const document = {
    readyState: "loading",
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    querySelector(selector) {
      if (selector === ".nav-links") return navLinks;
      return null;
    },
    createElement() {
      return makeElement({ appendChild() {} });
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const window = {
    webUnlockerAuth: auth,
    webUnlockerUI: ui,
    location: {
      pathname: "/auth",
      search: "",
      href: "http://example.test/auth",
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const context = {
    window,
    document,
    console,
    Error,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync("app/static/js/nav.js", "utf8"), context, { filename: "app/static/js/nav.js" });
  for (const listener of listeners.get("DOMContentLoaded") || []) {
    listener({ type: "DOMContentLoaded" });
  }
  return {
    window: context.window,
    document,
    authButton,
    dashboardLink,
    editorLink,
  };
}

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function makeElement(extra = {}) {
  const listeners = new Map();
  return {
    hidden: false,
    style: {},
    innerHTML: "",
    textContent: "",
    value: "",
    dataset: {},
    focusCalled: false,
    selectCalled: false,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry !== listener));
    },
    dispatch(type, target) {
      const entries = listeners.get(type) || [];
      const event = target && typeof target === "object" && ("target" in target || "preventDefault" in target || "defaultPrevented" in target)
        ? { type, ...target }
        : { type, target };
      for (const listener of entries) {
        listener(event);
      }
    },
    focus() {
      this.focusCalled = true;
    },
    select() {
      this.selectCalled = true;
    },
    classList: {
      toggle() {},
    },
    setAttribute() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    ...extra,
  };
}

function createHeadingNode(tagName, textContent, index) {
  return {
    tagName,
    textContent,
    blot: { index },
  };
}

function createDocumentRefs() {
  return {
    emptyState: makeElement(),
    writingSurface: makeElement(),
    titleInput: makeElement(),
  };
}

function createQuillStub() {
  return {
    contents: null,
    enabled: true,
    setContents(value) {
      this.contents = value;
    },
    enable(value) {
      this.enabled = value;
    },
  };
}

test("workspace hydrate forwards non-citation seed ids to hydrate route", async () => {
  const requests = [];
  installWindow({
    webUnlockerAuth: {
      async authFetch(path) {
        requests.push(path);
        return okResponse({ document: { id: "doc-1" } });
      },
    },
  });

  const api = createWorkspaceApi();
  await api.hydrateDocument("doc-1", {
    document_id: "doc-1",
    source_id: "source-1",
    quote_id: "quote-1",
    note_id: "note-1",
    mode: "seed_review",
  });

  assert.equal(
    requests[0],
    "/api/docs/doc-1/hydrate?seed_source_id=source-1&seed_quote_id=quote-1&seed_note_id=note-1&seed_mode=seed_review",
  );
});

test("auth fetch refreshes a resumed session and keeps bearer credentials attached", async () => {
  const requests = [];
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        },
        async refreshSession() {
          return {
            data: {
              session: {
                access_token: "token-resumed",
                refresh_token: "refresh-resumed",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async (_url, options = {}) => {
      requests.push(options);
      return okResponse({ ok: true });
    },
  });

  await runtime.window.webUnlockerAuth.authFetch("/api/docs", {
    headers: { Accept: "application/json" },
  });

  assert.equal(requests[0].headers.get("Authorization"), "Bearer token-resumed");
});

test("nav sign-out uses canonical session handling without legacy token bridge", async () => {
  let signOutCalls = 0;
  const runtime = loadNavRuntime({
    auth: {
      async getAccessToken() {
        return "token-present";
      },
      client: {
        auth: {
          async signOut() {
            signOutCalls += 1;
          },
        },
      },
    },
    ui: {
      createToastManager() {
        return { show() {} };
      },
      COPY: { success: { LOGOUT_SUCCESS: "Signed out." } },
    },
  });

  await flush();
  runtime.authButton.dispatch("click", {
    preventDefault() {},
    target: runtime.authButton,
  });
  await flush();

  assert.equal(signOutCalls, 1);
  assert.equal(runtime.window.location.href, "/");
});

test("editor html sanitization strips Grammarly artifacts before save", () => {
  const rawHtml = '<p data-gramm="true">Draft</p><grammarly-desktop-integration><span>noise</span></grammarly-desktop-integration><span data-gr-id="x" class="grammarly-something">Text</span>';
  const sanitized = sanitizeEditorHtml(rawHtml);

  assert.equal(sanitized.includes("grammarly-desktop-integration"), false);
  assert.equal(sanitized.includes("data-gramm"), false);
  assert.equal(sanitized.includes("data-gr-id"), false);
  assert.match(sanitized, /Draft/);
  assert.match(sanitized, /Text/);
});

test("editor delta composes incrementally without reading the live DOM", () => {
  const previousWindow = globalThis.window;
  try {
    installWindow({
      Quill: {
        import(name) {
          assert.equal(name, "delta");
          return class MockDelta {
            constructor(value = { ops: [] }) {
              this.ops = Array.isArray(value.ops) ? value.ops.slice() : [];
            }

            compose(change) {
              return { ops: [...this.ops, ...(change?.ops || [])] };
            }
          };
        },
      },
    });

    const next = composeEditorDelta(
      { ops: [{ insert: "Hello\n" }] },
      { ops: [{ retain: 5 }, { insert: " world" }] },
    );

    assert.deepEqual(next.ops, [{ insert: "Hello\n" }, { retain: 5 }, { insert: " world" }]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("normalized editor delta preserves block alignment attributes", () => {
  const aligned = normalizeEditorDelta({
    ops: [
      { insert: "Centered heading" },
      { insert: "\n", attributes: { header: 2, align: "center" } },
      { insert: "Body copy" },
      { insert: "\n", attributes: { align: "right" } },
      { insert: "Justified copy" },
      { insert: "\n", attributes: { align: "justify" } },
    ],
  });

  assert.deepEqual(aligned, {
    ops: [
      { insert: "Centered heading" },
      { insert: "\n", attributes: { header: 2, align: "center" } },
      { insert: "Body copy" },
      { insert: "\n", attributes: { align: "right" } },
      { insert: "Justified copy" },
      { insert: "\n", attributes: { align: "justify" } },
    ],
  });
});

test("autosave sends aligned delta without mutating paragraph order or formatting", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  const alignedDelta = {
    ops: [
      { insert: "Heading" },
      { insert: "\n", attributes: { header: 1, align: "center" } },
      { insert: "Body line" },
      { insert: "\n", attributes: { align: "right" } },
      { insert: "Closing line" },
      { insert: "\n" },
    ],
  };
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: alignedDelta,
    content_html: '<h1 style="text-align: center;">Heading</h1><p style="text-align: right;">Body line</p><p>Closing line</p>',
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ content_delta: alignedDelta });

  const saves = [];
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument(_documentId, payload) {
        saves.push(payload);
        return {
          id: "doc-1",
          title: "Draft 1",
          project_id: null,
          revision: "rev-2",
          updated_at: "rev-2",
          content_delta: payload.content_delta,
          content_html: payload.content_html,
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
    },
    eventBus: { emit() {} },
    snapshotProvider: () => ({ content_html: '<h1 style="text-align: center;">Heading</h1><p style="text-align: right;">Body line</p><p>Closing line</p>' }),
  });

  await autosave.flush();

  assert.deepEqual(saves[0].content_delta, alignedDelta);
  assert.equal(saves[0].content_html.includes("text-align: center"), true);
  assert.equal(saves[0].content_html.includes("text-align: right"), true);
});

test("document open rehydrates aligned delta without rewriting text", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  const refs = createDocumentRefs();
  const quillAdapter = createQuillStub();
  const alignedDelta = {
    ops: [
      { insert: "Centered heading" },
      { insert: "\n", attributes: { header: 2, align: "center" } },
      { insert: "Paragraph text" },
      { insert: "\n", attributes: { align: "justify" } },
    ],
  };
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        return {
          id: "doc-1",
          title: "Draft",
          project_id: null,
          content_delta: alignedDelta,
          content_html: '<h2 style="text-align: center;">Centered heading</h2><p style="text-align: justify;">Paragraph text</p>',
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        return { seed: null };
      },
    },
    refs,
    quillAdapter,
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  await controller.openDocument("doc-1", { awaitHydration: false });

  assert.deepEqual(quillAdapter.contents, alignedDelta);
  assert.equal(refs.titleInput.value, "Draft");
});

test("auth fetch waits for session rehydration before issuing a protected request", async () => {
  const timeline = [];
  let sessionReady = false;
  let releaseRefresh = null;
  let resolveRefreshStarted = null;
  const refreshStarted = new Promise((resolve) => {
    resolveRefreshStarted = resolve;
  });
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          timeline.push(`getSession:${sessionReady ? "ready" : "pending"}`);
          return sessionReady
            ? {
                data: {
                  session: {
                    access_token: "token-delayed",
                    refresh_token: "refresh-delayed",
                  },
                },
                error: null,
              }
            : { data: { session: null }, error: null };
        },
        async refreshSession() {
          timeline.push("refreshSession");
          resolveRefreshStarted();
          await refreshGate;
          sessionReady = true;
          return {
            data: {
              session: {
                access_token: "token-delayed",
                refresh_token: "refresh-delayed",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => {
      timeline.push("fetch");
      return okResponse({ ok: true });
    },
  });

  const pending = runtime.window.webUnlockerAuth.authFetch("/api/docs", {
    headers: { Accept: "application/json" },
  });

  await refreshStarted;
  assert.equal(timeline.includes("fetch"), false);
  assert.equal(timeline.includes("refreshSession"), true);
  releaseRefresh();

  await pending;
  assert.ok(timeline.indexOf("fetch") > timeline.indexOf("refreshSession"));
  assert.ok(timeline.some((entry) => entry === "getSession:pending"));
  assert.equal(sessionReady, true);
});

test("concurrent auth fetches share a single session lookup", async () => {
  let getSessionCalls = 0;
  let refreshSessionCalls = 0;
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          getSessionCalls += 1;
          return {
            data: { session: null },
            error: null,
          };
        },
        async refreshSession() {
          refreshSessionCalls += 1;
          return {
            data: {
              session: {
                access_token: "token-shared",
                refresh_token: "refresh-shared",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => okResponse({ ok: true }),
  });

  await Promise.all([
    runtime.window.webUnlockerAuth.authFetch("/api/docs", { headers: { Accept: "application/json" } }),
    runtime.window.webUnlockerAuth.authFetch("/api/docs", { headers: { Accept: "application/json" } }),
  ]);

  assert.equal(getSessionCalls, 1);
  assert.equal(refreshSessionCalls, 1);
});

test("auth fetch reuses a cached session snapshot after bootstrap", async () => {
  let createClientCalls = 0;
  let getSessionCalls = 0;
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          getSessionCalls += 1;
          return {
            data: {
              session: {
                access_token: "token-cached",
                refresh_token: "refresh-cached",
              },
            },
            error: null,
          };
        },
        async refreshSession() {
          return { data: { session: null }, error: null };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => okResponse({ ok: true }),
    createClientHook() {
      createClientCalls += 1;
    },
  });

  await runtime.window.webUnlockerAuth.getAccessToken();
  await runtime.window.webUnlockerAuth.authFetch("/api/docs", {
    headers: { Accept: "application/json" },
  });
  await runtime.window.webUnlockerAuth.authFetch("/api/docs", {
    headers: { Accept: "application/json" },
  });

  assert.equal(createClientCalls, 1);
  assert.equal(getSessionCalls, 1);
});

test("auth state callbacks can refresh preferences without re-entering session reads", async () => {
  let getSessionCalls = 0;
  let authCallback = null;
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          getSessionCalls += 1;
          return {
            data: {
              session: {
                access_token: "token-stable",
                refresh_token: "refresh-stable",
              },
            },
            error: null,
          };
        },
        async refreshSession() {
          return { data: { session: null }, error: null };
        },
        async onAuthStateChange(callback) {
          authCallback = callback;
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => okResponse({ ok: true }),
  });

  await runtime.window.webUnlockerAuth.getAccessToken();
  await runtime.window.webUnlockerAuth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_IN" && session?.access_token) {
      await runtime.window.webUnlockerAuth.authJson("/api/preferences", { headers: { Accept: "application/json" } });
    }
  });
  await authCallback("SIGNED_IN", {
    access_token: "token-stable",
    refresh_token: "refresh-stable",
  });
  await runtime.window.webUnlockerAuth.authJson("/api/preferences", { headers: { Accept: "application/json" } });

  assert.equal(getSessionCalls, 1);
});

test("theme init and sync are singleflight across repeated startup calls", async () => {
  let getCalls = 0;
  let subscriptionCalls = 0;
  let releaseGet = null;
  const getGate = new Promise((resolve) => {
    releaseGet = resolve;
  });
  const runtime = loadThemeRuntime({
    authJson: async (path, options = {}) => {
      if (path === "/api/preferences" && options.method === "GET") {
        getCalls += 1;
        await getGate;
        return { theme: "dark" };
      }
      return { theme: "dark" };
    },
    onAuthStateChange: async () => {
      subscriptionCalls += 1;
      return { data: { subscription: { unsubscribe() {} } }, error: null };
    },
    readyState: "complete",
  });

  const second = runtime.window.webUnlockerTheme.initTheme();
  releaseGet();
  await second;

  assert.equal(getCalls, 1);
  assert.equal(subscriptionCalls, 1);
  assert.equal(runtime.themeToggle.dataset.bound, "true");
});

test("sidebar init does not register duplicate auth listeners on repeated startup", async () => {
  let preferenceGets = 0;
  let subscriptionCalls = 0;
  let releaseGet = null;
  const getGate = new Promise((resolve) => {
    releaseGet = resolve;
  });
  const dom = createSidebarDom();
  const documentListeners = new Map();
  globalThis.document = {
    ...dom,
    body: dom.body,
    documentElement: dom.documentElement,
    getElementById(id) {
      return {
        "app-shell": dom.shell,
        "app-sidebar": dom.sidebar,
        "app-sidebar-toggle": dom.sidebarToggle,
        "app-sidebar-autohide-toggle": dom.sidebarAutoHideToggle,
        "app-sidebar-mobile-toggle": dom.mobileToggle,
        "app-sidebar-backdrop": dom.backdrop,
      }[id] || null;
    },
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || [];
      entries.push(listener);
      documentListeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      const entries = documentListeners.get(type) || [];
      documentListeners.set(type, entries.filter((entry) => entry !== listener));
    },
  };
  globalThis.window = {
    document: globalThis.document,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      };
    },
    addEventListener() {},
    removeEventListener() {},
    webUnlockerAuth: {
      async authJson(path, options = {}) {
        if (path === "/api/preferences" && options.method === "GET") {
          preferenceGets += 1;
          await getGate;
          return { sidebar_collapsed: false, sidebar_auto_hide: false };
        }
        return {};
      },
      async onAuthStateChange(callback) {
        subscriptionCalls += 1;
        return { data: { subscription: { unsubscribe() {} } }, error: null };
      },
    },
  };

  const first = initSidebarShell({ page: "editor" });
  const second = initSidebarShell({ page: "editor" });
  releaseGet();
  await first;
  await second;

  assert.equal(preferenceGets, 1);
  assert.equal(subscriptionCalls, 1);
  assert.equal(dom.shell.dataset.sidebarInitialized, "true");
});

test("autosave flush can wait for an auth bootstrap without deadlocking", async () => {
  let getSessionCalls = 0;
  let refreshSessionCalls = 0;
  let fetchCalls = 0;
  let releaseRefresh = null;
  const refreshGate = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          getSessionCalls += 1;
          return { data: { session: null }, error: null };
        },
        async refreshSession() {
          refreshSessionCalls += 1;
          await refreshGate;
          return {
            data: {
              session: {
                access_token: "token-autosave",
                refresh_token: "refresh-autosave",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async (_url, options = {}) => {
      fetchCalls += 1;
      assert.equal(options.headers.get("Authorization"), "Bearer token-autosave");
      return okResponse({ ok: true });
    },
  });
  globalThis.window = runtime.window;
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument(documentId, payload) {
        assert.equal(documentId, "doc-1");
        return runtime.window.webUnlockerAuth.authJson("/api/docs/doc-1", {
          method: "PATCH",
          body: payload,
        });
      },
    },
    eventBus: { emit() {} },
    snapshotProvider: () => ({ content_html: "<p>Updated title</p>" }),
  });

  const pending = autosave.flush();
  await Promise.resolve();
  assert.equal(fetchCalls, 0);
  releaseRefresh();
  await pending;

  assert.equal(getSessionCalls, 1);
  assert.equal(refreshSessionCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.equal(workspaceState.getState().save_status, "saved");
});

test("auth resume hooks refresh the session on visibility change", async () => {
  let refreshCalls = 0;
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        },
        async refreshSession() {
          refreshCalls += 1;
          return {
            data: {
              session: {
                access_token: "token-resumed",
                refresh_token: "refresh-resumed",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => okResponse({ ok: true }),
  });

  runtime.emitDocument("visibilitychange", {});
  await flush();

  assert.equal(refreshCalls, 1);
});

test("auth fetch fails fast with explicit missing-token error instead of issuing a protected request", async () => {
  let fetchCalls = 0;
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        },
        async refreshSession() {
          return { data: { session: null }, error: null };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return okResponse({ ok: true });
    },
  });

  await assert.rejects(
    () => runtime.window.webUnlockerAuth.authFetch("/api/docs", { headers: { Accept: "application/json" } }),
    (error) => isAuthSessionError(error) && error.code === "missing_credentials" && /bearer token/i.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test("workspace auth errors settle into a recoverable session-lost state without retrying forever", async () => {
  installWindow({
    setTimeout(_callback, delay) {
      if (!globalThis.__delayLog) {
        globalThis.__delayLog = [];
      }
      globalThis.__delayLog.push(delay);
      return globalThis.__delayLog.length;
    },
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  globalThis.__delayLog = [];
  globalThis.navigator = { onLine: true };
  const events = [];
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument() {
        throw createAuthSessionError("missing_credentials", "Missing bearer token.");
      },
    },
    eventBus: { emit(name) { events.push(name); } },
  });

  await assert.rejects(() => autosave.flush(), /Missing bearer token/);

  assert.equal(workspaceState.getState().runtime_failures.session.message, "Missing bearer token.");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "error");
  assert.equal(workspaceState.getState().runtime_activity.flush.phase, "error");
  assert.ok(!globalThis.__delayLog.some((delay) => delay === 1500 || delay === 3000));
  assert.deepEqual(events, ["doc.flush.started", "doc.save.started", "doc.save.failed", "doc.flush.failed"]);
});

test("outline derives headings from the live editor surface and supports normal heading levels", () => {
  installWindow({
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    Quill: {
      find(node) {
        return node.blot;
      },
    },
  });
  const nodes = [
    createHeadingNode("H1", "Overview", 0),
    createHeadingNode("H4", "Methods", 18),
  ];
  const refs = { outlineList: makeElement() };
  const quillAdapter = {
    root: {
      querySelectorAll() {
        return nodes;
      },
    },
    quill: {
      getIndex(blot) {
        return blot.index;
      },
    },
    getContents() {
      return { ops: [] };
    },
    focus() {},
    setSelection() {},
  };

  const controller = createOutlineController({ refs, quillAdapter });
  const items = controller.compute();

  assert.deepEqual(items, [
    { level: 1, text: "Overview", index: 0 },
    { level: 4, text: "Methods", index: 18 },
  ]);
  assert.match(refs.outlineList.innerHTML, /Overview/);
  assert.match(refs.outlineList.innerHTML, /Methods/);
});

test("outline recomputes after heading edits and insert/delete mutations", async () => {
  installWindow({
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    Quill: {
      find(node) {
        return node.blot;
      },
    },
  });
  const nodes = [createHeadingNode("H2", "Original heading", 6)];
  const refs = { outlineList: makeElement() };
  const quillAdapter = {
    root: {
      querySelectorAll() {
        return nodes;
      },
    },
    quill: {
      getIndex(blot) {
        return blot.index;
      },
    },
    getContents() {
      return {
        ops: [
          { insert: "Original heading\n", attributes: { header: 2 } },
        ],
      };
    },
    focus() {},
    setSelection() {},
  };

  const controller = createOutlineController({ refs, quillAdapter });
  controller.compute();
  assert.match(refs.outlineList.innerHTML, /Original heading/);

  nodes[0].textContent = "Updated heading";
  nodes.push(createHeadingNode("H3", "Inserted section", 31));
  controller.schedule({ ops: [{ insert: "Updated heading" }] });
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.match(refs.outlineList.innerHTML, /Updated heading/);
  assert.match(refs.outlineList.innerHTML, /Inserted section/);
  assert.doesNotMatch(refs.outlineList.innerHTML, /Original heading/);
});

test("workspace saves and preferences sync share the same canonical authJson helper", async () => {
  const requests = [];
  const authJson = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/api/preferences") {
      return { sidebar_collapsed: true, sidebar_auto_hide: false };
    }
    if (path === "/api/docs/doc-1") {
      return {
        id: "doc-1",
        title: "Updated title",
        project_id: null,
        content_delta: { ops: [{ insert: "Draft 1\n" }] },
        content_html: "<p>Draft 1</p>",
        attached_citation_ids: [],
        attached_note_ids: [],
        tag_ids: [],
      };
    }
    return {};
  };
  installWindow({
    webUnlockerAuth: {
      authJson,
      setProtectedRequestObserver() {},
      onAuthStateChange: null,
    },
  });

  const sidebar = makeElement();
  const toggle = makeElement();
  const autoHideToggle = makeElement();
  const mobileToggle = makeElement();
  const backdrop = makeElement();
  globalThis.document = {
    body: makeElement(),
    getElementById(id) {
      return {
        "app-shell": makeElement(),
        "app-sidebar": sidebar,
        "app-sidebar-toggle": toggle,
        "app-sidebar-autohide-toggle": autoHideToggle,
        "app-sidebar-mobile-toggle": mobileToggle,
        "app-sidebar-backdrop": backdrop,
      }[id] || null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window.document = globalThis.document;
  globalThis.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = createWorkspaceApi();
  await api.updateDocument("doc-1", {
    revision: "2026-01-02T00:00:00+00:00",
    title: "Updated title",
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    project_id: null,
  });
  await initSidebarShell({ page: "editor" });
  toggle.dispatch("click");
  await flush();

  assert.equal(requests[0].path, "/api/docs/doc-1");
  assert.equal(requests[0].options.method, "PATCH");
  assert.deepEqual(requests[0].options.body, {
    revision: "2026-01-02T00:00:00+00:00",
    title: "Updated title",
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    project_id: null,
  });
  assert.equal(requests[1].path, "/api/preferences");
  assert.equal(requests[1].options.method, "GET");
  assert.equal(requests[2].path, "/api/preferences");
  assert.equal(requests[2].options.method, "PATCH");
  assert.deepEqual(requests[2].options.body, {
    sidebar_collapsed: false,
    sidebar_auto_hide: false,
  });
});

test("canonical auth helper serializes object payloads and preserves non-json bodies", async () => {
  const requests = [];
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          return {
            data: {
              session: {
                access_token: "token-json",
                refresh_token: "refresh-json",
              },
            },
            error: null,
          };
        },
        async refreshSession() {
          return {
            data: {
              session: {
                access_token: "token-json",
                refresh_token: "refresh-json",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async (_url, options = {}) => {
      requests.push(options);
      return okResponse({ ok: true, data: { saved: true } });
    },
  });

  await runtime.window.webUnlockerAuth.authJson("/api/preferences", {
    method: "PATCH",
    headers: { Accept: "application/json" },
    body: {
      sidebar_collapsed: true,
      sidebar_auto_hide: false,
    },
  });

  const passthrough = new URLSearchParams("mode=fast");
  await runtime.window.webUnlockerAuth.authFetch("/api/upload", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: passthrough,
  });

  assert.equal(requests[0].body, JSON.stringify({
    sidebar_collapsed: true,
    sidebar_auto_hide: false,
  }));
  assert.equal(requests[0].headers.get("Content-Type"), "application/json");
  assert.equal(requests[1].body, passthrough);
});

test("canonical protected helper reports request metadata and attaches bearer for resumed /api/preferences requests", async () => {
  const observed = [];
  const runtime = loadAuthRuntime({
    client: {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null };
        },
        async refreshSession() {
          return {
            data: {
              session: {
                access_token: "token-observed",
                refresh_token: "refresh-observed",
              },
            },
            error: null,
          };
        },
        async onAuthStateChange() {
          return { data: { subscription: { unsubscribe() {} } }, error: null };
        },
        async setSession() {
          return { data: { session: null }, error: null };
        },
        async signOut() {},
      },
    },
    fetchImpl: async () => okResponse({ ok: true, data: { sidebar_collapsed: false } }),
  });

  runtime.window.webUnlockerAuth.setProtectedRequestObserver((meta) => observed.push(meta));
  await runtime.window.webUnlockerAuth.authJson("/api/preferences", {
    method: "PATCH",
    headers: { Accept: "application/json" },
    body: { sidebar_collapsed: true },
  });

  assert.equal(observed[0].helper, "authFetch");
  assert.equal(observed[0].authorizationAttached, true);
  assert.equal(observed[0].waitedForSessionReady, true);
  assert.equal(observed[0].url, "/api/preferences");
});

test("autosave skips retrying deterministic validation failures", async () => {
  const delays = [];
  installWindow({
    setTimeout(callback, delay) {
      delays.push(delay);
      if (delay === 650) {
        queueMicrotask(callback);
      }
      return delays.length;
    },
    clearTimeout() {},
  });
  globalThis.navigator = { onLine: true };
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument() {
        const error = new Error("Input should be a valid dictionary or object to extract fields from");
        error.status = 422;
        error.payload = {
          detail: {
            type: "model_attributes_type",
            msg: "Input should be a valid dictionary or object to extract fields from",
            input: "[object Object]",
          },
        };
        throw error;
      },
    },
    eventBus: { emit() {} },
  });

  autosave.schedule();
  await flush();

  assert.equal(delays[0], 650);
  assert.equal(delays.filter((delay) => delay === 1500 || delay === 3000).length, 0);
  assert.equal(workspaceState.getState().save_status, "error");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "error");
});

test("session loss renders a recoverable editor state instead of a generic timeout", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setSessionFailure({ code: "missing_credentials", message: "Missing bearer token." });
  const target = makeElement();

  renderContextRail(target, { mode: "idle" }, workspaceState.getState(), null, {});

  assert.match(target.innerHTML, /Session lost/);
  assert.match(target.innerHTML, /Sign in again/);
  assert.match(target.innerHTML, /Unsaved work stays in the editor/i);
});

test("note context rail exposes explicit document attach controls for canonical note-document links", () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const linkActions = createLinkActions({
    workspaceState,
    attachActions: { async attachNote() {} },
  });
  const target = makeElement();

  renderContextRail(target, { mode: "note_focus" }, workspaceState.getState(), {
    id: "note-1",
    title: "Claim note",
    note_body: "Evidence summary",
    note_links: [{ linked_note_id: "note-2", link_type: "supports" }],
    tags: [],
    evidence_links: [],
  }, { linkActions });

  assert.match(target.innerHTML, /Document attachment/);
  assert.match(target.innerHTML, /Attach to current document/);
  assert.match(target.innerHTML, /Not attached/);
  assert.match(target.innerHTML, /Draft chapter/);
  assert.doesNotMatch(target.innerHTML, /Related notes/);
});

test("citation context rail exposes explicit document attach controls for canonical citation-document links", () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const linkActions = createLinkActions({
    workspaceState,
    attachActions: { async attachCitation() {} },
  });
  const target = makeElement();

  renderContextRail(target, { mode: "citation_focus" }, workspaceState.getState(), {
    id: "citation-1",
    source: { id: "source-1", title: "Source title", hostname: "example.test" },
    renders: { mla: { bibliography: "Source title" } },
    primary_render: { style: "mla", kind: "bibliography", text: "Source title" },
  }, {
    linkActions,
    citationViewState: new Map(),
  });

  assert.match(target.innerHTML, /Document attachment/);
  assert.match(target.innerHTML, /Attach to current document/);
  assert.match(target.innerHTML, /Not attached/);
  assert.match(target.innerHTML, /Draft chapter/);
});

test("note context rail reflects attached document links immediately after save", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const linkActions = createLinkActions({
    workspaceState,
    attachActions: {
      async attachNote() {
        workspaceState.markSavedFromServer({
          id: "doc-1",
          title: "Draft chapter",
          revision: "rev-2",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft chapter\n" }] },
          attached_citation_ids: [],
          attached_note_ids: ["note-1"],
          tag_ids: [],
        });
      },
    },
  });

  await linkActions.attachNoteToCurrentDocument("note-1");

  const target = makeElement();
  renderContextRail(target, { mode: "note_focus" }, workspaceState.getState(), {
    id: "note-1",
    title: "Claim note",
    note_body: "Evidence summary",
    relationship_groups: {
      evidence_links_by_role: { primary: [], supporting: [], background: [] },
      note_links_by_type: { supports: [], contradicts: [], extends: [], related: [] },
    },
    tags: [],
    evidence_links: [],
    attached_documents: [{ id: "doc-1", title: "Draft chapter", status: "active" }],
  }, { linkActions });

  assert.match(target.innerHTML, /Attached/);
  assert.match(target.innerHTML, /Remove attachment/);
  assert.match(target.innerHTML, /data-related-document-id="doc-1"/);
});

test("citation context rail reflects attached state and removal affordance immediately after save", () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    revision: "rev-2",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: ["citation-1"],
    attached_note_ids: [],
    tag_ids: [],
  });
  const linkActions = createLinkActions({
    workspaceState,
    attachActions: { async attachCitation() {}, async detachCitation() {} },
  });
  const target = makeElement();

  renderContextRail(target, { mode: "citation_focus" }, workspaceState.getState(), {
    id: "citation-1",
    source: { id: "source-1", title: "Source title", hostname: "example.test" },
    renders: { mla: { bibliography: "Source title" } },
    primary_render: { style: "mla", kind: "bibliography", text: "Source title" },
    attached_documents: [{ id: "doc-1", title: "Draft chapter", status: "active" }],
  }, {
    linkActions,
    citationViewState: new Map(),
  });

  assert.match(target.innerHTML, /Attached/);
  assert.match(target.innerHTML, /Remove attachment/);
  assert.doesNotMatch(target.innerHTML, />Attach to current document</);
});

test("unsupported attach types stay hidden from citation detail panels while citation attach remains available", () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const target = makeElement();

  renderContextRail(target, { mode: "citation_focus" }, workspaceState.getState(), {
    id: "citation-1",
    source: { id: "source-1", title: "Source title", hostname: "example.test" },
    renders: { mla: { bibliography: "Source title" } },
    primary_render: { style: "mla", kind: "bibliography", text: "Source title" },
  }, {
    linkActions: createLinkActions({
      workspaceState,
      attachActions: { async attachCitation() {} },
    }),
    citationViewState: new Map(),
  });

  assert.doesNotMatch(target.innerHTML, /attach-note-to-document/);
  assert.doesNotMatch(target.innerHTML, /attach-quote-to-document/);
  assert.match(target.innerHTML, /Document attachment/);
});

test("cross-user note attach rejections are surfaced as permission errors without mutating document links", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const feedbackEvents = [];
  const linkActions = createLinkActions({
    workspaceState,
    attachActions: {
      async attachNote() {
        const error = new Error("You cannot attach that note to this document.");
        error.status = 403;
        throw error;
      },
    },
    feedback: {
      emitDomainEvent(name, payload) {
        feedbackEvents.push({ name, payload });
      },
    },
  });

  const result = await linkActions.attachNoteToCurrentDocument("note-9");

  assert.equal(result, null);
  assert.deepEqual(workspaceState.getState().attached_relation_ids.notes, []);
  assert.deepEqual(feedbackEvents, [{
    name: FEEDBACK_EVENTS.PERMISSION_DENIED,
    payload: {
      message: "You cannot attach that note to this document.",
      dedupeKey: "note-attach-permission-denied",
    },
  }]);
});

test("failed attachment state is rendered for note detail after backend rejection", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft chapter",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft chapter\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const linkActions = createLinkActions({
    workspaceState,
    attachActions: {
      async attachNote() {
        workspaceState.setAttachmentFailure("note", "note-1", { message: "Invalid note references", mode: "attach" });
        const error = new Error("Invalid note references");
        error.status = 422;
        throw error;
      },
    },
    feedback: { emitDomainEvent() {} },
  });

  await assert.rejects(() => linkActions.attachNoteToCurrentDocument("note-1"), /Invalid note references/);

  const target = makeElement();
  renderContextRail(target, { mode: "note_focus" }, workspaceState.getState(), {
    id: "note-1",
    title: "Claim note",
    note_body: "Evidence summary",
    tags: [],
    evidence_links: [],
  }, { linkActions });

  assert.match(target.innerHTML, /Failed/);
  assert.match(target.innerHTML, /Invalid note references/);
});

test("structured auth error payloads preserve a readable message instead of object stringification", () => {
  const error = createAuthSessionErrorFromPayload({
    detail: {
      type: "model_attributes_type",
      msg: "Input should be a valid dictionary or object to extract fields from",
      input: "[object Object]",
    },
  }, 401, "/api/citations");

  assert.equal(error?.code, "missing_credentials");
  assert.equal(error?.message, "Input should be a valid dictionary or object to extract fields from");
});

test("citation display title falls back to primary citation text when source title is unavailable", () => {
  assert.equal(
    citationDisplayTitle({
      source: { title: "" },
      primary_render: { style: "mla", kind: "bibliography", text: "Useful source title. Longer bibliography detail follows." },
    }),
    "Useful source title.",
  );
});

test("attached hydrate payloads are consumed into runtime state and primed stores", async () => {
  const workspaceState = createWorkspaceState();
  const calls = { citationGet: 0 };
  const citation = { id: "citation-1", source: { id: "source-1", title: "Source 1" } };
  const note = { id: "note-1", title: "Note 1" };
  const quote = { id: "quote-1", excerpt: "Quote 1", citation_id: "citation-1" };
  const source = { id: "source-1", title: "Source 1" };
  const api = {
    async listSources() { return []; },
    async getSource() { throw new Error("should not fetch source"); },
    async listCitations() { return []; },
    async getCitation() { calls.citationGet += 1; return citation; },
    async listQuotes() { return []; },
    async getQuote() { throw new Error("should not fetch quote"); },
    async listNotes() { return []; },
    async getNote() { throw new Error("should not fetch note"); },
  };
  const stores = {
    sources: createSourceStore(api),
    citations: createCitationStore(api),
    quotes: createQuoteStore(api),
    notes: createNoteStore(api),
  };
  const hydrator = createResearchHydrator({
    workspaceState,
    eventBus: { emit() {} },
    stores,
    renderExplorer() {},
  });

  hydrator.consumeDocumentHydration({
    attached_citations: [citation],
    attached_notes: [note],
    attached_quotes: [quote],
    derived_sources: [source],
  });

  assert.equal(workspaceState.getState().attached_research.citations[0].id, "citation-1");
  const focused = await hydrator.hydrateFocused({ type: "citation", id: "citation-1" });
  assert.equal(focused.id, "citation-1");
  assert.equal(calls.citationGet, 0);
});

test("autosave flush settles to idle after success", async () => {
  installWindow();
  globalThis.navigator = { onLine: true };
  const events = [];
  const snapshots = [];
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument(documentId, payload) {
        snapshots.push({ documentId, payload });
        return {
          id: "doc-1",
          title: "Updated title",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft 1\n" }] },
          content_html: "<p>Draft 1</p>",
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
    },
    snapshotProvider: () => ({ content_html: "<p>Updated title</p>" }),
    eventBus: { emit(name) { events.push(name); } },
  });

  await autosave.flush();

  assert.equal(workspaceState.getState().save_status, "saved");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "idle");
  assert.equal(workspaceState.getState().runtime_activity.flush.phase, "idle");
  assert.equal(snapshots[0].payload.content_html, "<p>Updated title</p>");
  assert.deepEqual(events, ["doc.flush.started", "doc.save.started", "doc.save.succeeded", "doc.flush.succeeded"]);
});

test("autosave flush settles to error after failure", async () => {
  installWindow();
  globalThis.navigator = { onLine: true };
  const events = [];
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument() {
        throw new Error("Save blew up");
      },
    },
    eventBus: { emit(name) { events.push(name); } },
  });

  await assert.rejects(() => autosave.flush(), /Save blew up/);

  assert.equal(workspaceState.getState().save_status, "error");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "error");
  assert.equal(workspaceState.getState().runtime_activity.flush.phase, "error");
  assert.deepEqual(events, ["doc.flush.started", "doc.save.started", "doc.save.failed", "doc.flush.failed"]);
});

test("autosave flush settles to error after save timeout", async () => {
  installWindow({
    setTimeout(callback, delay) {
      if (delay === 12000) {
        queueMicrotask(callback);
      }
      return 1;
    },
    clearTimeout() {},
  });
  globalThis.navigator = { onLine: true };
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument() {
        return new Promise(() => {});
      },
    },
    eventBus: { emit() {} },
  });

  await assert.rejects(() => autosave.flush(), /Save timed out/);

  assert.equal(workspaceState.getState().save_status, "error");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "error");
  assert.equal(workspaceState.getState().runtime_activity.flush.phase, "error");
});

test("autosave conflict enters an explicit recoverable conflict state", async () => {
  installWindow();
  globalThis.navigator = { onLine: true };
  const events = [];
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Updated title" });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument() {
        const error = new Error("Document changed on another surface.");
        error.status = 409;
        error.payload = {
          detail: {
            code: "revision_conflict",
            message: "Document changed on another surface. Reload latest before saving again.",
            expected_revision: "rev-1",
            current_revision: "rev-2",
            current_document: {
              id: "doc-1",
              title: "Remote title",
              revision: "rev-2",
              project_id: null,
              content_delta: { ops: [{ insert: "Remote\n" }] },
              content_html: "<p>Remote</p>",
              attached_citation_ids: [],
              attached_note_ids: [],
              tag_ids: [],
            },
          },
        };
        throw error;
      },
    },
    eventBus: { emit(name) { events.push(name); } },
  });

  await assert.rejects(() => autosave.flush(), /Document changed on another surface/);

  assert.equal(workspaceState.getState().save_status, "conflict");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "conflict");
  assert.equal(workspaceState.getState().runtime_failures.document_conflict.current_revision, "rev-2");
  assert.equal(workspaceState.getState().runtime_failures.document_conflict.source, "autosave");
  assert.deepEqual(events, ["doc.flush.started", "doc.save.started", "doc.save.conflict", "doc.flush.failed"]);
});

test("autosave flush clears a stale saving indicator when the document is already clean", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.setSaveStatus("saving");
  workspaceState.setSaveActivity({ phase: "running", sequence: 7, message: null });
  const autosave = createAutosaveController({
    workspaceState,
    workspaceApi: {
      async updateDocument() {
        throw new Error("should not save when the document is clean");
      },
    },
    eventBus: { emit() {} },
  });

  await autosave.flush();

  assert.equal(workspaceState.getState().save_status, "saved");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "idle");
  assert.equal(workspaceState.getState().runtime_activity.flush.phase, "idle");
});

test("attachment conflict preserves local snapshot instead of overwriting newer backend state", async () => {
  installWindow();
  const events = [];
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    content_html: "<p>Draft 1</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const attachActions = createAttachActions({
    workspaceState,
    workspaceApi: {
      async replaceDocumentCitations() {
        const error = new Error("Document changed on another surface.");
        error.status = 409;
        error.payload = {
          detail: {
            code: "revision_conflict",
            message: "Document changed on another surface. Reload latest before saving again.",
            expected_revision: "rev-1",
            current_revision: "rev-2",
            current_document: {
              id: "doc-1",
              title: "Remote title",
              revision: "rev-2",
              project_id: null,
              content_delta: { ops: [{ insert: "Remote\n" }] },
              content_html: "<p>Remote</p>",
              attached_citation_ids: ["citation-remote"],
              attached_note_ids: [],
              tag_ids: [],
            },
          },
        };
        throw error;
      },
      async replaceDocumentNotes() {
        throw new Error("should not be called");
      },
    },
    eventBus: { emit(name) { events.push(name); } },
  });

  await assert.rejects(() => attachActions.attachCitation("citation-local"), /Document changed on another surface/);

  assert.equal(workspaceState.getState().save_status, "conflict");
  assert.equal(workspaceState.getState().attached_relation_ids.citations.length, 0);
  assert.equal(workspaceState.getState().runtime_failures.document_conflict.source, "attach_citation");
  assert.deepEqual(events, ["doc.save.conflict"]);
});

test("successful citation attach refreshes attached research from canonical hydrate payload", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const attachActions = createAttachActions({
    workspaceState,
    workspaceApi: {
      async replaceDocumentCitations() {
        return {
          id: "doc-1",
          title: "Draft 1",
          revision: "rev-2",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft 1\n" }] },
          attached_citation_ids: ["citation-1"],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        return {
          document: {
            id: "doc-1",
            title: "Draft 1",
            revision: "rev-2",
            project_id: null,
            attached_citation_ids: ["citation-1"],
            attached_note_ids: [],
            tag_ids: [],
          },
          attached_citations: [{ id: "citation-1", source: { id: "source-1", title: "Source title" } }],
          attached_notes: [],
          attached_quotes: [],
          derived_sources: [{ id: "source-1", title: "Source title" }],
        };
      },
      async replaceDocumentNotes() {
        throw new Error("should not be called");
      },
    },
    eventBus: { emit() {} },
  });

  await attachActions.attachCitation("citation-1");

  assert.deepEqual(workspaceState.getState().attached_relation_ids.citations, ["citation-1"]);
  assert.deepEqual(workspaceState.getState().attached_research.citations.map((item) => item.id), ["citation-1"]);
  assert.equal(workspaceState.getState().hydration.attached_ready, true);
});

test("attached hydrate does not overwrite a newer local edit", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        return {
          id: "doc-1",
          title: "Remote title",
          revision: "rev-1",
          project_id: null,
          content_delta: { ops: [{ insert: "Remote title\n" }] },
          content_html: "<p>Remote title</p>",
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        return {
          document: {
            id: "doc-1",
            title: "Remote title",
            revision: "rev-1",
            project_id: null,
            content_delta: { ops: [{ insert: "Remote title\n" }] },
            content_html: "<p>Remote title</p>",
            attached_citation_ids: [],
            attached_note_ids: [],
            tag_ids: [],
          },
          attached_citations: [],
          attached_notes: [],
          attached_quotes: [],
          derived_sources: [],
        };
      },
    },
    refs: createDocumentRefs(),
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  await controller.openDocument("doc-1");
  workspaceState.markDirty({ title: "Local title" });
  workspaceState.setSaveStatus("saving");
  workspaceState.setSaveActivity({ phase: "running", sequence: 9, message: null });
  await flush();
  await flush();

  assert.equal(workspaceState.getState().dirty, true);
  assert.equal(workspaceState.getState().active_document.title, "Local title");
  assert.equal(workspaceState.getState().save_status, "saving");
});

test("refreshing after conflict resolves the editor to backend truth", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Local draft",
    revision: "rev-1",
    project_id: null,
    content_delta: { ops: [{ insert: "Local draft\n" }] },
    content_html: "<p>Local draft</p>",
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Local draft" });
  workspaceState.setDocumentConflict({
    code: "revision_conflict",
    message: "Document changed on another surface. Reload latest before saving again.",
    current_revision: "rev-2",
    current_document: { id: "doc-1", title: "Remote title", revision: "rev-2" },
    source: "autosave",
  });
  const refs = createDocumentRefs();
  refs.titleInput.value = "Local draft";
  const hydratorCalls = [];
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument(documentId) {
        assert.equal(documentId, "doc-1");
        return {
          id: "doc-1",
          title: "Remote title",
          revision: "rev-2",
          project_id: null,
          content_delta: { ops: [{ insert: "Remote title\n" }] },
          content_html: "<p>Remote title</p>",
          attached_citation_ids: ["citation-remote"],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        return {
          document: { id: "doc-1", title: "Remote title", revision: "rev-2" },
          attached_citations: [],
          attached_notes: [],
          attached_quotes: [],
          derived_sources: [],
        };
      },
    },
    refs,
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: {
      consumeDocumentHydration(payload) {
        hydratorCalls.push(payload);
      },
    },
    eventBus: { emit() {} },
  });

  await controller.reloadCurrentDocument();
  await flush();

  assert.equal(workspaceState.getState().dirty, false);
  assert.equal(workspaceState.getState().active_document.title, "Remote title");
  assert.equal(workspaceState.getState().active_document.revision, "rev-2");
  assert.equal(workspaceState.getState().save_status, "saved");
  assert.equal(workspaceState.getState().runtime_failures.document_conflict, null);
  assert.equal(refs.titleInput.value, "Remote title");
  assert.equal(hydratorCalls.length, 1);
});

test("dirty document switches block when save flush fails", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft 1",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft 1\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  workspaceState.markDirty({ title: "Unsaved title" });

  const refs = createDocumentRefs();
  const quillAdapter = createQuillStub();
  let getDocumentCalls = 0;
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        getDocumentCalls += 1;
        return { id: "doc-2", title: "Draft 2", content_delta: { ops: [{ insert: "Draft 2\n" }] } };
      },
      async hydrateDocument() {
        return { document: { id: "doc-2", title: "Draft 2", content_delta: { ops: [{ insert: "Draft 2\n" }] } } };
      },
      async createDocument() {
        return { id: "doc-3" };
      },
    },
    refs,
    quillAdapter,
    autosaveController: {
      async flush() {
        throw new Error("Save failed");
      },
      schedule() {},
    },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  const result = await controller.openDocument("doc-2");

  assert.equal(result, false);
  assert.equal(getDocumentCalls, 0);
  assert.match(workspaceState.getState().runtime_failures.document_transition.message, /save failed|unsaved/i);
});

test("document hydrate failure is user-visible and recoverable in context rail state", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  const refs = createDocumentRefs();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        return {
          id: "doc-1",
          title: "Draft",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft\n" }] },
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        throw new Error("Hydrate exploded");
      },
    },
    refs,
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  await controller.openDocument("doc-1", { seed: { quote_id: "quote-1", citation_id: "citation-1" } });
  await flush();
  const target = makeElement();
  renderContextRail(target, { mode: "idle" }, workspaceState.getState(), null, {});

  assert.match(target.innerHTML, /Document context failed to load/);
  assert.match(target.innerHTML, /Retry hydrate/);
});

test("explorer load failure renders a retryable recovery state", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const refs = {
    explorerStatus: makeElement(),
    explorerList: makeElement(),
    explorerSearch: makeElement(),
    explorerTabs: [],
  };
  const controller = createExplorerController({
    workspaceState,
    refs,
    renderers: { renderDocumentList() {} },
    hydrator: {
      async hydrateExplorer() {
        throw new Error("Explorer failed");
      },
    },
    onOpenDocument() {},
    onFocusEntity() {},
    onEntityAction() {},
  });

  await controller.beginEntityAction({ action: "insert", entityType: "quote" });

  assert.match(refs.explorerStatus.textContent, /unavailable/i);
  assert.match(refs.explorerList.innerHTML, /Retry/);
});

test("checkpoint refresh failure renders a retryable recovery state", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const refs = { checkpointsList: makeElement(), checkpointStatus: makeElement() };
  const controller = createCheckpointController({
    workspaceState,
    workspaceApi: {
      async listCheckpoints() {
        throw new Error("Checkpoint refresh failed");
      },
    },
    refs,
    eventBus: { emit() {} },
  });

  await controller.refresh();

  assert.match(refs.checkpointsList.innerHTML, /Checkpoint refresh failed/);
  assert.match(refs.checkpointsList.innerHTML, /Retry checkpoints/);
  assert.match(refs.checkpointStatus.textContent, /Checkpoint error/);
});

test("explorer picker routes entity clicks into real insert flow callbacks", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const citationsTab = makeElement({ dataset: { explorerTab: "citations" } });
  const quotesTab = makeElement({ dataset: { explorerTab: "quotes" } });
  const refs = {
    explorerStatus: makeElement(),
    explorerList: makeElement(),
    explorerSearch: makeElement(),
    explorerTabs: [citationsTab, quotesTab],
  };
  const calls = [];
  const controller = createExplorerController({
    workspaceState,
    refs,
    renderers: { renderDocumentList() {} },
    hydrator: { async hydrateExplorer() { return []; } },
    onOpenDocument() {},
    onFocusEntity() {
      throw new Error("focus should not run while picker is armed");
    },
    onEntityAction(pending, entity) {
      calls.push({ pending, entity });
    },
  });
  controller.bind();

  await controller.beginEntityAction({ action: "insert", entityType: "citation" });
  refs.explorerList.dispatch("click", {
    closest(selector) {
      if (selector === "[data-explorer-retry]") return null;
      if (selector === "[data-document-id]") return null;
      if (selector === "[data-entity-id]") return { dataset: { entityId: "citation-9" } };
      return null;
    },
  });

  assert.deepEqual(calls, [{
    pending: { action: "insert", entityType: "citation" },
    entity: { type: "citation", id: "citation-9" },
  }]);
});

test("citation explorer rows render canonical citation titles and primary text", () => {
  const target = makeElement();

  renderExplorerList(target, "citations", [{
    id: "citation-1",
    source: {
      id: "source-1",
      title: "Source 1",
      hostname: "example.com",
      issued_date: { raw: "2026" },
    },
    primary_render: { style: "mla", kind: "bibliography", text: "Source 1 bibliography" },
    renders: { mla: { bibliography: "Source 1 bibliography" } },
    excerpt: "Source 1 excerpt",
  }], null);

  assert.match(target.innerHTML, /Source 1/);
  assert.match(target.innerHTML, /Source 1 bibliography/);
  assert.match(target.innerHTML, /example\.com/);
});

test("context rail note actions use canonical note creation routes", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: "project-1",
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });

  const requests = [];
  const convertActions = createConvertActions({
    researchApi: {
      async createNoteFromQuote(quoteId, payload) {
        requests.push({ type: "quote", quoteId, payload });
        return { id: "note-2", title: payload.title, note_body: payload.note_body };
      },
    },
    attachActions: {
      async attachNote(noteId) {
        requests.push({ type: "convert-attach", noteId });
      },
    },
    insertActions: { async insertNote() {} },
    workspaceState,
    eventBus: { emit() {} },
    stores: { notes: { prime() {} }, quotes: { prime() {} } },
    feedback: { emitDomainEvent() {}, toast: { success() {} } },
  });
  const noteActions = createNoteActions({
    researchApi: {
      async createNote(payload) {
        requests.push({ type: "selection", payload });
        return { id: "note-1", title: payload.title, note_body: payload.note_body };
      },
    },
    attachActions: {
      async attachNote(noteId) {
        requests.push({ type: "attach", noteId });
      },
    },
    workspaceState,
    eventBus: { emit() {} },
    stores: { notes: { prime() {} } },
    convertActions,
  });

  await noteActions.createNoteFromSelection("Selected evidence for chapter");
  await noteActions.createNoteFromQuote({ id: "quote-1", excerpt: "Quoted evidence" });

  assert.equal(requests[0].type, "selection");
  assert.equal(requests[0].payload.project_id, "project-1");
  assert.equal(requests[1].type, "attach");
  assert.equal(requests[2].type, "quote");
  assert.equal(requests[2].quoteId, "quote-1");
  assert.equal(requests[3].type, "convert-attach");
});

test("quote conversion surfaces permission failures cleanly without mutating focus", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  workspaceState.setDocument({
    id: "doc-1",
    title: "Draft",
    project_id: null,
    content_delta: { ops: [{ insert: "Draft\n" }] },
    attached_citation_ids: [],
    attached_note_ids: [],
    tag_ids: [],
  });
  const feedbackEvents = [];
  const convertActions = createConvertActions({
    researchApi: {
      async createNoteFromQuote() {
        const error = new Error("You cannot convert that quote to a note.");
        error.status = 403;
        throw error;
      },
    },
    attachActions: {
      async attachNote() {},
    },
    insertActions: { async insertNote() {} },
    workspaceState,
    eventBus: { emit() {} },
    stores: { notes: { prime() {} }, quotes: { prime() {} } },
    feedback: {
      emitDomainEvent(name, payload) {
        feedbackEvents.push({ name, payload });
      },
      toast: { success() {} },
    },
  });

  const result = await convertActions.convertQuoteToNote({ id: "quote-1", excerpt: "Quoted evidence" });

  assert.equal(result, null);
  assert.equal(workspaceState.getState().focused_entity, null);
  assert.deepEqual(feedbackEvents, [{
    name: FEEDBACK_EVENTS.PERMISSION_DENIED,
    payload: {
      message: "You cannot convert that quote to a note.",
      dedupeKey: "quote-to-note-permission-denied:quote-1",
    },
  }]);
});

test("open document settles transition even when hydrate never resolves", async () => {
  installWindow({
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
  });
  const events = [];
  const workspaceState = createWorkspaceState();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        return {
          id: "doc-1",
          title: "Draft",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft\n" }] },
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        return new Promise(() => {});
      },
    },
    refs: createDocumentRefs(),
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit(name) { events.push(name); } },
  });

  const result = await controller.openDocument("doc-1");
  await flush();

  assert.equal(result, true);
  assert.equal(workspaceState.getState().runtime_activity.document_transition.phase, "idle");
  assert.equal(workspaceState.getState().runtime_activity.hydrate.phase, "error");
  assert.match(workspaceState.getState().runtime_failures.document_hydrate.message, /timed out/i);
  assert.ok(events.includes("document.transition.succeeded"));
  assert.ok(events.includes("document.hydrate.failed"));
});

test("booted document open waits for hydration before revealing the writing surface", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  let releaseHydrate = null;
  const hydrateStarted = new Promise((resolve) => {
    releaseHydrate = resolve;
  });
  const hydratePayload = {
    document: {
      id: "doc-1",
      title: "Draft",
      revision: "rev-1",
      project_id: null,
      content_delta: { ops: [{ insert: "Draft\n" }] },
      content_html: "<p>Draft</p>",
      attached_citation_ids: [],
      attached_note_ids: [],
      tag_ids: [],
    },
    attached_citations: [],
    attached_notes: [],
    attached_quotes: [],
    derived_sources: [],
  };
  const refs = createDocumentRefs();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument(documentId) {
        assert.equal(documentId, "doc-1");
        return hydratePayload.document;
      },
      async hydrateDocument(documentId, seed) {
        assert.equal(documentId, "doc-1");
        assert.deepEqual(seed, { quote_id: "quote-1" });
        await hydrateStarted;
        return hydratePayload;
      },
    },
    refs,
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: {
      consumeDocumentHydration(payload) {
        assert.deepEqual(payload, hydratePayload);
      },
    },
    eventBus: { emit() {} },
  });

  const pending = controller.openDocument("doc-1", {
    seed: { quote_id: "quote-1" },
    awaitHydration: true,
  });

  await flush();
  assert.equal(refs.writingSurface.hidden, true);
  let settled = false;
  pending.then(() => {
    settled = true;
  });
  await flush();
  assert.equal(settled, false);

  releaseHydrate();
  const result = await pending;

  assert.equal(result, true);
  assert.equal(refs.writingSurface.hidden, false);
  assert.equal(workspaceState.getState().hydration.attached_ready, true);
});

test("hydrate prime failure leaves recoverable non-busy state", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument() {
        return {
          id: "doc-1",
          title: "Draft",
          project_id: null,
          content_delta: { ops: [{ insert: "Draft\n" }] },
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument() {
        return { document: { id: "doc-1", title: "Draft", content_delta: { ops: [{ insert: "Draft\n" }] } } };
      },
    },
    refs: createDocumentRefs(),
    quillAdapter: createQuillStub(),
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: {
      consumeDocumentHydration() {
        throw new Error("Prime failed");
      },
    },
    eventBus: { emit() {} },
  });

  await controller.openDocument("doc-1");
  await flush();

  assert.equal(workspaceState.getState().runtime_activity.hydrate.phase, "error");
  assert.equal(workspaceState.getState().runtime_activity.document_transition.phase, "idle");
  assert.match(workspaceState.getState().runtime_failures.document_hydrate.message, /Prime failed/);
});

test("repeated document navigation does not deadlock transition state", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  const refs = createDocumentRefs();
  const quillAdapter = createQuillStub();
  const controller = createDocumentController({
    workspaceState,
    workspaceApi: {
      async getDocument(documentId) {
        return {
          id: documentId,
          title: `Draft ${documentId}`,
          project_id: null,
          content_delta: { ops: [{ insert: `${documentId}\n` }] },
          attached_citation_ids: [],
          attached_note_ids: [],
          tag_ids: [],
        };
      },
      async hydrateDocument(documentId) {
        return {
          document: {
            id: documentId,
            title: `Draft ${documentId}`,
            project_id: null,
            content_delta: { ops: [{ insert: `${documentId}\n` }] },
            attached_citation_ids: [],
            attached_note_ids: [],
            tag_ids: [],
          },
        };
      },
    },
    refs,
    quillAdapter,
    autosaveController: { async flush() {}, schedule() {} },
    hydrator: { consumeDocumentHydration() {} },
    eventBus: { emit() {} },
  });

  await controller.openDocument("doc-1");
  await controller.openDocument("doc-2");
  await controller.openDocument("doc-3");
  await flush();

  assert.equal(workspaceState.getState().active_document_id, "doc-3");
  assert.equal(workspaceState.getState().runtime_activity.document_transition.phase, "idle");
  assert.notEqual(workspaceState.getState().runtime_activity.hydrate.phase, "running");
});

test("detail hydration flag updates do not re-enter forever", async () => {
  installWindow();
  const workspaceState = createWorkspaceState();
  let notifications = 0;
  workspaceState.subscribe(() => {
    notifications += 1;
  });

  workspaceState.setDetailHydrated("citation:1", true);
  const afterFirst = notifications;
  workspaceState.setDetailHydrated("citation:1", true);

  assert.equal(notifications, afterFirst);
});
