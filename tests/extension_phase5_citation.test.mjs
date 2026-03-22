import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { renderCitationModal } from "../extension/sidepanel/app/citation_modal.js";

class FakeEvent {
  constructor(type, target, init = {}) {
    this.type = type;
    this.target = target;
    this.key = init.key || "";
    this.ctrlKey = Boolean(init.ctrlKey);
    this.metaKey = Boolean(init.metaKey);
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

  replaceChildren(...children) {
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  click() {
    this.dispatchEvent(new FakeEvent("click", this));
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body", this);
    this.documentElement = new FakeElement("html", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
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
  return null;
}

function createRuntime({ renderResult, renderError } = {}) {
  return createBackgroundRuntime({
    chromeApi: {
      runtime: {
        lastError: null,
        sendMessage() {},
      },
      storage: {
        local: {
          async get(defaults) {
            return {
              ...defaults,
              writior_auth_session: {
                access_token: "token-1",
                token_type: "bearer",
                user_id: "user-1",
                email: "user@example.com",
              },
            };
          },
          async set() {},
          async remove() {},
        },
      },
    },
    captureApi: {
      createCitation() {
        throw new Error("captureCitation should not run in phase5 citation tests");
      },
      createQuote() {
        throw new Error("createQuote should not run");
      },
      createNote() {
        throw new Error("createNote should not run");
      },
    },
    citationApi: {
      async renderCitation(payload) {
        if (renderError) {
          return {
            ok: false,
            status: "error",
            error: renderError,
          };
        }
        return {
          ok: true,
          status: "ok",
          data: renderResult || {
            renders: {
              mla: {
                inline: "(WHO 6)",
                bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
                footnote: "World Health Organization. \"Public Health Update.\" WHO.",
              },
            },
            cache_hit: false,
          },
        };
      },
    },
  });
}

test("citation modal switches style and format using backend-derived previews only", async () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  const renderCalls = [];
  const saveCalls = [];
  const clipboardWrites = [];

  const modal = renderCitationModal(root, {
    citation: {
      id: "citation-1",
      style: "apa",
      format: "bibliography",
      inline_citation: "(World Health Organization, 2024, para. 6)",
      full_citation: "World Health Organization. (2024). Public health update. WHO.",
      footnote: "World Health Organization. (2024). Public health update. WHO.",
      metadata: {
        title: "Public health update",
        author: "World Health Organization",
        canonical_url: "https://example.com/articles/demo",
      },
    },
    render_bundle: null,
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: ["chicago", "harvard"],
    loading: false,
    error: null,
  }, {
    documentRef,
    navigatorRef: {
      clipboard: {
        async writeText(text) {
          clipboardWrites.push(text);
        },
      },
    },
    onRequestRender: async (payload) => {
      renderCalls.push(payload);
      return {
        ok: true,
        data: {
          renders: {
            mla: {
              inline: "(World Health Organization 6)",
              bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
              footnote: "World Health Organization. \"Public Health Update.\" WHO.",
            },
          },
          cache_hit: false,
        },
      };
    },
    onSave: async (payload) => {
      saveCalls.push(payload);
      return { ok: true, data: { saved: true } };
    },
  });

  assert.match(modal.getState().text, /Public health update/);
  const locked = root.children[0].children[3].children.filter((button) => button.getAttribute("data-locked") === "true");
  assert.equal(locked.length, 2);

  const styleTabs = findByAttr(root, "data-citation-style-tabs", "true");
  const mlaButton = styleTabs.children.find((button) => button.getAttribute("data-style") === "mla");
  await mlaButton.dispatchEvent(new FakeEvent("click", mlaButton));
  await Promise.resolve();

  assert.equal(renderCalls.length, 1);
  assert.equal(modal.getState().selectedStyle, "mla");
  assert.match(modal.getState().text, /World Health Organization/);

  const formatTabs = findByAttr(root, "data-citation-format-tabs", "true");
  const inlineButton = formatTabs.children.find((button) => button.getAttribute("data-format") === "inline");
  await inlineButton.dispatchEvent(new FakeEvent("click", inlineButton));
  assert.equal(modal.getState().selectedFormat, "inline");
  assert.match(modal.getState().text, /\(World Health Organization 6\)/);

  const copyButton = findByAttr(root, "data-citation-copy", "true");
  await copyButton.dispatchEvent(new FakeEvent("click", copyButton));
  await Promise.resolve();
  assert.equal(clipboardWrites.at(-1), "(World Health Organization 6)");
  assert.equal(saveCalls.at(-1)?.copy, true);

  const saveButton = findByAttr(root, "data-citation-save", "true");
  await saveButton.dispatchEvent(new FakeEvent("click", saveButton));
  await Promise.resolve();
  assert.equal(saveCalls.at(-1)?.copy, false);
  assert.equal(saveCalls.at(-1)?.format, "inline");
});

test("background citation render returns backend render bundles and save persists modal selection in background", async () => {
  const runtime = createRuntime({
    renderResult: {
      renders: {
        chicago: {
          inline: "(World Health Organization 2024)",
          bibliography: "World Health Organization. Public Health Update. WHO, 2024.",
          footnote: "World Health Organization, Public Health Update (WHO, 2024).",
        },
      },
      cache_hit: true,
    },
  });

  const renderResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_RENDER,
    requestId: "req-render",
    payload: {
      surface: "content",
      citationId: "citation-1",
      style: "chicago",
    },
  });

  assert.equal(renderResult.ok, true);
  assert.match(renderResult.data.renders.chicago.bibliography, /WHO, 2024/);

  const saveResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_SAVE,
    requestId: "req-save",
    payload: {
      surface: "content",
      citationId: "citation-1",
      style: "chicago",
      format: "footnote",
      copy: true,
    },
  });

  assert.equal(saveResult.ok, true);
  assert.equal(saveResult.data.saved, true);
  assert.equal(saveResult.data.style, "chicago");
  assert.equal(saveResult.data.format, "footnote");
  assert.equal(saveResult.data.copy, true);
});

test("citation modal shows loading and error states without collapsing", () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");

  renderCitationModal(root, {
    citation: null,
    render_bundle: null,
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: [],
    loading: true,
    error: null,
  }, { documentRef });

  assert.match(findByAttr(root, "data-citation-preview-body", "true").textContent, /Loading citation preview/);

  renderCitationModal(root, {
    citation: null,
    render_bundle: null,
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: [],
    loading: false,
    error: { code: "citation_error", message: "Preview failed." },
  }, { documentRef });

  assert.match(findByAttr(root, "data-citation-preview-body", "true").textContent, /Preview failed/);
});

test("backend citation render errors map cleanly and save rejects invalid payloads", async () => {
  const runtime = createRuntime({
    renderError: { code: "unauthorized", message: "No bearer token is available." },
  });

  const renderResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_RENDER,
    requestId: "req-render-fail",
    payload: {
      surface: "content",
      citationId: "citation-1",
      style: "mla",
    },
  });

  assert.equal(renderResult.ok, false);
  assert.equal(renderResult.error.code, "unauthorized");
  assert.match(renderResult.error.message, /No bearer token is available/);

  const saveResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_SAVE,
    requestId: "req-save-invalid",
    payload: {
      surface: "content",
      citationId: "",
      style: "mla",
      format: "inline",
    },
  });

  assert.equal(saveResult.ok, false);
  assert.equal(saveResult.error.code, "invalid_payload");
});
