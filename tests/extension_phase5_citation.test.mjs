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

function collectText(node) {
  if (!node) {
    return "";
  }
  const parts = [];
  if (typeof node.textContent === "string" && node.textContent.trim()) {
    parts.push(node.textContent.trim());
  }
  for (const child of node.children || []) {
    const text = collectText(child);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(" ");
}

function createRuntime({ previewResult, previewError, renderResult, renderError, saveResult, saveError } = {}) {
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
      async previewCitation(payload) {
        if (previewError) {
          return {
            ok: false,
            status: "error",
            error: previewError,
          };
        }
        return {
          ok: true,
          status: "ok",
          data: previewResult || {
            citation: {
              id: null,
              source_id: null,
              source: {
                title: "Public health update",
                canonical_url: "https://example.com/articles/demo",
                authors: [{ fullName: "World Health Organization" }],
              },
              renders: {
                apa: {
                  inline: "(World Health Organization, 2024, para. 6)",
                  bibliography: "World Health Organization. (2024). Public health update. WHO.",
                  footnote: "World Health Organization. (2024). Public health update. WHO.",
                  quote_attribution: "\"Selected sentence\" (World Health Organization, 2024, para. 6)",
                },
              },
            },
            render_bundle: {
              renders: {
                apa: {
                  inline: "(World Health Organization, 2024, para. 6)",
                  bibliography: "World Health Organization. (2024). Public health update. WHO.",
                  footnote: "World Health Organization. (2024). Public health update. WHO.",
                  quote_attribution: "\"Selected sentence\" (World Health Organization, 2024, para. 6)",
                },
              },
              cache_hit: false,
            },
            selected_style: payload.style || "apa",
          },
        };
      },
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
                quote_attribution: "\"Selected sentence\" (WHO 6)",
              },
            },
            cache_hit: false,
          },
        };
      },
      async saveCitation(_payload) {
        if (saveError) {
          return {
            ok: false,
            status: "error",
            error: saveError,
          };
        }
        return {
          ok: true,
          status: "ok",
          data: saveResult || {
            id: "citation-1",
            source_id: "source-1",
            source: {
              id: "source-1",
              title: "Public health update",
              canonical_url: "https://example.com/articles/demo",
              authors: [{ fullName: "World Health Organization" }],
            },
            locator: {},
            annotation: null,
            excerpt: "Selected sentence",
            quote_text: "Selected sentence",
            renders: {
              chicago: {
                inline: "(World Health Organization 2024)",
                bibliography: "World Health Organization. Public Health Update. WHO, 2024.",
                footnote: "World Health Organization, Public Health Update (WHO, 2024).",
                quote_attribution: "\"Selected sentence\" (World Health Organization 2024)",
              },
            },
            relationship_counts: {},
          },
        };
      },
    },
  });
}

test("citation modal switches style and format using backend-derived previews only before save", async () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  const previewCalls = [];
  const saveCalls = [];
  const clipboardWrites = [];

  const modal = renderCitationModal(root, {
    citation: {
      id: null,
      style: "apa",
      format: "bibliography",
      source: {
        title: "Public health update",
        canonical_url: "https://example.com/articles/demo",
        authors: [{ fullName: "World Health Organization" }],
        issued_date: { raw: "2024-03-10", year: 2024 },
        source_type: "report",
        publisher: "World Health Organization",
        identifiers: { doi: "10.1000/who-demo" },
        quality: { author_status: "available", date_status: "available", limited_metadata: false },
      },
    },
    render_bundle: {
      renders: {
        apa: {
          inline: "(World Health Organization, 2024, para. 6)",
          bibliography: "World Health Organization. (2024). Public health update. WHO.",
          footnote: "World Health Organization. (2024). Public health update. WHO.",
          quote_attribution: "\"Selected sentence\" (World Health Organization, 2024, para. 6)",
        },
      },
      cache_hit: false,
    },
    draft_payload: {
      capture: {
        selectionText: "Selected sentence",
        pageTitle: "Public health update",
        pageUrl: "https://example.com/articles/demo",
        pageDomain: "example.com",
      },
    },
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
    onRequestPreview: async (payload) => {
      previewCalls.push(payload);
      return {
        ok: true,
        data: {
          citation: {
            id: null,
            source_id: null,
            source: {
              title: "Public health update",
              canonical_url: "https://example.com/articles/demo",
              authors: [{ fullName: "World Health Organization" }],
              issued_date: { raw: "2024-03-10", year: 2024 },
              source_type: "report",
              publisher: "World Health Organization",
              identifiers: { doi: "10.1000/who-demo" },
              quality: { author_status: "available", date_status: "available", limited_metadata: false },
            },
            renders: {
              mla: {
                inline: "(World Health Organization 6)",
                bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
                footnote: "World Health Organization. \"Public Health Update.\" WHO.",
                quote_attribution: "\"Selected sentence\" (World Health Organization 6)",
              },
            },
          },
          render_bundle: {
            renders: {
              mla: {
                inline: "(World Health Organization 6)",
                bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
                footnote: "World Health Organization. \"Public Health Update.\" WHO.",
                quote_attribution: "\"Selected sentence\" (World Health Organization 6)",
              },
            },
            cache_hit: false,
          },
          selected_style: "mla",
        },
      };
    },
    onRequestRender: async () => ({ ok: false, error: { code: "unused", message: "render should not run before save" } }),
    onSave: async (payload) => {
      saveCalls.push(payload);
      return {
        ok: true,
        data: {
          id: "citation-1",
          source_id: "source-1",
          source: {
            id: "source-1",
            title: "Public health update",
            canonical_url: "https://example.com/articles/demo",
            authors: [{ fullName: "World Health Organization" }],
            issued_date: { raw: "2024-03-10", year: 2024 },
            source_type: "report",
            publisher: "World Health Organization",
            identifiers: { doi: "10.1000/who-demo" },
            quality: { author_status: "available", date_status: "available", limited_metadata: false },
          },
          locator: {},
          annotation: null,
          excerpt: "Selected sentence",
          quote_text: "Selected sentence",
          renders: {
            mla: {
              inline: "(World Health Organization 6)",
              bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
              footnote: "World Health Organization. \"Public Health Update.\" WHO.",
              quote_attribution: "\"Selected sentence\" (World Health Organization 6)",
            },
          },
          render_bundle: {
            renders: {
              mla: {
                inline: "(World Health Organization 6)",
                bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
                footnote: "World Health Organization. \"Public Health Update.\" WHO.",
                quote_attribution: "\"Selected sentence\" (World Health Organization 6)",
              },
            },
            styles: [
              {
                style: "mla",
                kinds: ["bibliography", "footnote", "quote_attribution", "inline"],
                texts: {
                  inline: "(World Health Organization 6)",
                  bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
                  footnote: "World Health Organization. \"Public Health Update.\" WHO.",
                  quote_attribution: "\"Selected sentence\" (World Health Organization 6)",
                },
              },
            ],
            primary: {
              style: "mla",
              kind: "bibliography",
              text: "World Health Organization. \"Public Health Update.\" WHO.",
            },
          },
          relationship_counts: {},
        },
      };
    },
  });

  assert.match(modal.getState().text, /Public health update/);
  const locked = findByAttr(root, "data-citation-style-tabs", "true").children.filter((button) => button.getAttribute("data-locked") === "true");
  assert.equal(locked.length, 2);

  const styleTabs = findByAttr(root, "data-citation-style-tabs", "true");
  const mlaButton = styleTabs.children.find((button) => button.getAttribute("data-style") === "mla");
  await mlaButton.dispatchEvent(new FakeEvent("click", mlaButton));
  await Promise.resolve();

  assert.equal(previewCalls.length, 1);
  assert.equal(modal.getState().selectedStyle, "mla");
  assert.match(modal.getState().text, /World Health Organization/);
  assert.match(collectText(root.children[0]), /DOI/);

  const formatTabs = findByAttr(root, "data-citation-format-tabs", "true");
  const inlineButton = formatTabs.children.find((button) => button.getAttribute("data-format") === "inline");
  await inlineButton.dispatchEvent(new FakeEvent("click", inlineButton));
  assert.equal(modal.getState().selectedFormat, "inline");
  assert.match(modal.getState().text, /\(World Health Organization 6\)/);

  const copyButton = findByAttr(root, "data-citation-copy", "true");
  await copyButton.dispatchEvent(new FakeEvent("click", copyButton));
  await Promise.resolve();
  assert.equal(clipboardWrites.at(-1), "(World Health Organization 6)");
  assert.equal(saveCalls.length, 0);

  const saveButton = findByAttr(root, "data-citation-save", "true");
  await saveButton.dispatchEvent(new FakeEvent("click", saveButton));
  await Promise.resolve();
  assert.equal(saveCalls.at(-1)?.capture?.selectionText, "Selected sentence");
  assert.equal(saveCalls.at(-1)?.format, "inline");
  assert.equal(modal.getState().citation?.id, "citation-1");
  assert.match(modal.getState().text, /\(World Health Organization 6\)/);
});

test("background citation preview and render return backend bundles and save returns hydrated citation", async () => {
  const runtime = createRuntime({
    renderResult: {
      renders: {
        chicago: {
          inline: "(World Health Organization 2024)",
          bibliography: "World Health Organization. Public Health Update. WHO, 2024.",
          footnote: "World Health Organization, Public Health Update (WHO, 2024).",
          quote_attribution: "\"Selected sentence\" (World Health Organization 2024)",
        },
      },
      cache_hit: true,
    },
  });

  const previewResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_PREVIEW,
    requestId: "req-preview",
    payload: {
      surface: "content",
      capture: {
        selectionText: "Selected sentence",
        pageTitle: "Public health update",
        pageUrl: "https://example.com/articles/demo",
        pageDomain: "example.com",
      },
      style: "chicago",
    },
  });

  assert.equal(previewResult.ok, true);
  assert.match(previewResult.data.citation.renders.apa.quote_attribution, /Selected sentence/);

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
      capture: {
        selectionText: "Selected sentence",
        pageTitle: "Public health update",
        pageUrl: "https://example.com/articles/demo",
        pageDomain: "example.com",
      },
      style: "chicago",
      format: "footnote",
    },
  });

  assert.equal(saveResult.ok, true);
  assert.equal(saveResult.data.id, "citation-1");
  assert.equal(saveResult.data.selected_style, "chicago");
  assert.equal(saveResult.data.selected_format, "footnote");
  assert.match(saveResult.data.renders.chicago.quote_attribution, /Selected sentence/);
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

test("citation modal surfaces missing or inferred metadata honestly", () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");

  renderCitationModal(root, {
    citation: {
      id: null,
      style: "apa",
      format: "bibliography",
      source: {
        title: "Sparse web reference",
        canonical_url: "https://example.com/sparse",
        publisher: "Example Site",
        source_type: "webpage",
        quality: { author_status: "organization_fallback", date_status: "missing", limited_metadata: true },
      },
    },
    render_bundle: {
      renders: {
        apa: {
          bibliography: "Example Site. (n.d.). Sparse web reference. https://example.com/sparse",
        },
      },
    },
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: [],
    loading: false,
    error: null,
  }, { documentRef });

  const visible = collectText(root.children[0]);
  assert.match(visible, /Organization fallback/);
  assert.match(visible, /Publication date missing/);
  assert.match(visible, /Limited metadata/);
});

test("backend citation preview/render errors map cleanly and save rejects invalid payloads", async () => {
  const runtime = createRuntime({
    previewError: { code: "unauthorized", message: "No bearer token is available." },
    renderError: { code: "unauthorized", message: "No bearer token is available." },
  });

  const previewResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_PREVIEW,
    requestId: "req-preview-fail",
    payload: {
      surface: "content",
      capture: {
        selectionText: "Selected sentence",
        pageTitle: "Public health update",
        pageUrl: "https://example.com/articles/demo",
        pageDomain: "example.com",
      },
      style: "mla",
    },
  });

  assert.equal(previewResult.ok, false);
  assert.equal(previewResult.error.code, "unauthorized");

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
      capture: {
        selectionText: "",
        pageTitle: "Public health update",
        pageUrl: "https://example.com/articles/demo",
        pageDomain: "example.com",
      },
      style: "mla",
      format: "inline",
    },
  });

  assert.equal(saveResult.ok, false);
  assert.equal(saveResult.error.code, "invalid_payload");
});
