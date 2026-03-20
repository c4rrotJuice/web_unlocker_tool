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
import { createAttachActions } from "../../app/static/js/editor_v2/actions/attach_actions.js";
import { renderContextRail } from "../../app/static/js/editor_v2/ui/context_rail_renderer.js";
import { createExplorerController } from "../../app/static/js/editor_v2/research/explorer_controller.js";
import { createCheckpointController } from "../../app/static/js/editor_v2/document/checkpoint_controller.js";
import { createNoteActions } from "../../app/static/js/editor_v2/actions/note_actions.js";
import { createAuthSessionError, isAuthSessionError } from "../../app/static/js/shared/auth/session.js";
import { initSidebarShell } from "../../app/static/js/app_shell/core/sidebar.js";

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
  const existing = globalThis.window || {};
  const window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    addEventListener() {},
    removeEventListener() {},
    location: { pathname: "/", search: "" },
    webUnlockerAuth: existing.webUnlockerAuth,
    ...existing,
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

function loadAuthRuntime({ client, fetchImpl }) {
  const listeners = new Map();
  const documentListeners = new Map();
  const window = {
    WRITIOR_SUPABASE_URL: "https://supabase.example.test",
    WRITIOR_SUPABASE_ANON_KEY: "anon-key",
    supabase: {
      createClient() {
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

async function flush(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

function makeElement(extra = {}) {
  const listeners = new Map();
  return {
    hidden: false,
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
      for (const listener of entries) {
        listener({ type, target });
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
    setContents(value) {
      this.contents = value;
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
    attached_sources: [source],
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
    eventBus: { emit(name) { events.push(name); } },
  });

  await autosave.flush();

  assert.equal(workspaceState.getState().save_status, "saved");
  assert.equal(workspaceState.getState().runtime_activity.save.phase, "idle");
  assert.equal(workspaceState.getState().runtime_activity.flush.phase, "idle");
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
          attached_sources: [],
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
          attached_sources: [],
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
    explorerHeading: makeElement(),
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

  assert.match(refs.explorerStatus.textContent, /failed/i);
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

  const refs = { checkpointsList: makeElement() };
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
    explorerHeading: makeElement(),
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
  const noteActions = createNoteActions({
    researchApi: {
      async createNote(payload) {
        requests.push({ type: "selection", payload });
        return { id: "note-1", title: payload.title, note_body: payload.note_body };
      },
      async createNoteFromQuote(quoteId, payload) {
        requests.push({ type: "quote", quoteId, payload });
        return { id: "note-2", title: payload.title, note_body: payload.note_body };
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
  });

  await noteActions.createNoteFromSelection("Selected evidence for chapter");
  await noteActions.createNoteFromQuote({ id: "quote-1", excerpt: "Quoted evidence" });

  assert.equal(requests[0].type, "selection");
  assert.equal(requests[0].payload.project_id, "project-1");
  assert.equal(requests[1].type, "attach");
  assert.equal(requests[2].type, "quote");
  assert.equal(requests[2].quoteId, "quote-1");
  assert.equal(requests[3].type, "attach");
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
