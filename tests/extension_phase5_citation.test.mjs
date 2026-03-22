import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { createBackgroundRuntime } from "../extension/background/index.js";
import { MESSAGE_NAMES } from "../extension/shared/constants/message_names.js";
import { renderCitationModal } from "../extension/sidepanel/app/citation_modal.js";

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
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) {
      return;
    }
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body", this);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function createChromeStub() {
  const messages = [];
  const sidePanelOpenCalls = [];
  return {
    messages,
    sidePanelOpenCalls,
    runtime: {
      lastError: null,
      sendMessage(message) {
        messages.push(message);
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
    sidePanel: {
      open(args) {
        sidePanelOpenCalls.push(args);
      },
    },
  };
}

function createResponse(data) {
  return { ok: true, data, meta: {} };
}

function createRuntime() {
  const captureCalls = [];
  const renderCalls = [];
  const chromeApi = createChromeStub();
  const captureApi = {
    async createCitation(payload) {
      captureCalls.push(payload);
      return createResponse({
        id: "citation-1",
        style: "apa",
        format: "bibliography",
        inline_citation: "(World Health Organization, 2024, para. 6)",
        full_citation: "World Health Organization. (2024). Public health update. WHO.",
        footnote: "World Health Organization. (2024). Public health update. WHO.",
        quote_attribution: "\"Selected sentence\" (World Health Organization, 2024, para. 6)",
        metadata: {
          title: "Public health update",
          author: "World Health Organization",
          site_name: "WHO",
          canonical_url: payload.pageUrl,
        },
      });
    },
  };
  const citationApi = {
    async renderCitation(payload) {
      renderCalls.push(payload);
      return createResponse({
        renders: {
          apa: {
            inline: "(World Health Organization, 2024, para. 6)",
            bibliography: "World Health Organization. (2024). Public health update. WHO.",
            footnote: "World Health Organization. (2024). Public health update. WHO.",
          },
          mla: {
            inline: "(World Health Organization 6)",
            bibliography: "World Health Organization. \"Public Health Update.\" WHO.",
            footnote: "World Health Organization. \"Public Health Update.\" WHO.",
          },
        },
        cache_hit: false,
      });
    },
  };
  const runtime = createBackgroundRuntime({
    chromeApi,
    captureApi,
    citationApi,
    baseUrl: "https://app.writior.com",
  });
  return { runtime, chromeApi, captureCalls, renderCalls };
}

function createSelectedCitationState() {
  return {
    status: "ready",
    visible: true,
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
        site_name: "WHO",
        canonical_url: "https://example.com/articles/demo",
      },
    },
    render_bundle: null,
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: ["chicago", "harvard"],
    loading: false,
    error: null,
    saved: false,
    saved_at: null,
  };
}

test("citation modal opens from cite action and uses backend-rendered text only", async () => {
  const { runtime, chromeApi, captureCalls, renderCalls } = createRuntime();
  const captureResult = await runtime.dispatch({
    type: MESSAGE_NAMES.CAPTURE_CREATE_CITATION,
    payload: {
      surface: "content",
      capture: {
        selectionText: "Selected sentence",
        pageTitle: "Public health update",
        pageUrl: "https://example.com/articles/demo",
        pageDomain: "example.com",
      },
    },
  }, { tab: { windowId: 7 } });

  assert.equal(captureResult.ok, true);
  assert.equal(captureCalls.length, 1);
  assert.equal(chromeApi.sidePanelOpenCalls.length, 1);

  const stateResult = await runtime.dispatch({ type: MESSAGE_NAMES.CITATION_GET_STATE });
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  const navigatorRef = {
    clipboard: {
      lastText: "",
      async writeText(text) {
        this.lastText = text;
      },
    },
  };
  const modal = renderCitationModal(root, stateResult.data.citation, {
    documentRef,
    navigatorRef,
    onRequestRender: (payload) => runtime.dispatch({ type: MESSAGE_NAMES.CITATION_RENDER, payload }),
    onSave: (payload) => runtime.dispatch({ type: MESSAGE_NAMES.CITATION_SAVE_STATE, payload }),
  });

  const previewText = modal.getState().text;
  assert.equal(previewText.includes("World Health Organization"), true);
  assert.equal(root.children[0].children[2].children.length >= 1, true);
  assert.equal(renderCalls.length, 0);
  assert.equal(fs.readFileSync(new URL("../extension/sidepanel/app/citation_modal.ts", import.meta.url), "utf8").includes("render_citation"), false);

  const styleButtons = root.children[0].children[2].children;
  const mlaButton = styleButtons.find((button) => button.getAttribute("data-style") === "mla");
  await mlaButton.dispatchEvent(new FakeEvent("click", mlaButton));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renderCalls.length, 1);
  assert.equal(modal.getState().selectedStyle, "mla");
  assert.match(modal.getState().text, /World Health Organization/);
  const afterStyle = await runtime.dispatch({ type: MESSAGE_NAMES.CITATION_GET_STATE });
  assert.equal(afterStyle.data.citation.selected_style, "mla");

  const formatTabs = root.children[0].children[3].children;
  const inlineButton = formatTabs.find((button) => button.getAttribute("data-format") === "inline");
  await inlineButton.dispatchEvent(new FakeEvent("click", inlineButton));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(modal.getState().selectedFormat, "inline");

  const copyButton = root.children[0].children[5].children[0];
  await copyButton.dispatchEvent(new FakeEvent("click", copyButton));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(modal.getState().selectedFormat, "inline");
  assert.equal(modal.getState().text.length > 0, true);
  assert.equal(navigatorRef.clipboard.lastText.includes("World Health Organization"), true);
  const afterCopy = await runtime.dispatch({ type: MESSAGE_NAMES.CITATION_GET_STATE });
  assert.equal(afterCopy.data.citation.saved, true);
});

test("locked styles remain visible from backend capability data", () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  const modal = renderCitationModal(root, createSelectedCitationState(), {
    documentRef,
  });

  const styleButtons = root.children[0].children[2].children;
  const locked = styleButtons.filter((button) => button.getAttribute("data-locked") === "true");
  assert.equal(locked.length, 2);
  assert.equal(modal.getState().lockedStyles.includes("chicago"), true);
  assert.equal(modal.getState().lockedStyles.includes("harvard"), true);
});

test("background render request returns canonical backend render bundles", async () => {
  const { runtime, renderCalls } = createRuntime();
  const response = await runtime.dispatch({
    type: MESSAGE_NAMES.CITATION_RENDER,
    payload: { citation_id: "citation-1", style: "mla" },
  });

  assert.equal(response.ok, true);
  assert.equal(renderCalls[0].citation_id, "citation-1");
  assert.equal(response.data.renders.mla.bibliography.includes("WHO"), true);
});

test("citation modal shows loading and error states clearly", () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("div");
  renderCitationModal(root, {
    status: "loading",
    visible: true,
    loading: true,
    selected_style: "apa",
    selected_format: "bibliography",
    citation: null,
    error: null,
  }, { documentRef });
  assert.match(root.children[0].children[4].children[1].textContent, /Loading citation preview/);

  root.children = [];
  renderCitationModal(root, {
    status: "error",
    visible: true,
    loading: false,
    selected_style: "apa",
    selected_format: "bibliography",
    citation: null,
    error: { code: "citation_error", message: "Preview failed." },
  }, { documentRef });
  assert.match(root.children[0].children[4].children[1].textContent, /Preview failed/);
});
