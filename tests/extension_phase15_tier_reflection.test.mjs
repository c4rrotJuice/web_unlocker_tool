import test from "node:test";
import assert from "node:assert/strict";

import { renderPopupAuthSnapshot } from "../extension/popup/app/index.js";
import { renderSidepanelAuthSnapshot } from "../extension/sidepanel/app/index.js";
import { renderCitationModal } from "../extension/sidepanel/app/citation_modal.js";
import { createSelectionMenu } from "../extension/content/ui/selection_menu.js";
import { createUsageSummaryList } from "../extension/sidepanel/components/usage_summary_list.js";
import { normalizeCapabilitySurface } from "../extension/shared/types/capability_surface.js";

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
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = new Map();
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.title = "";
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach((node) => this.appendChild(node));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
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
}

function collectText(node) {
  if (!node) {
    return "";
  }
  const parts = [];
  if (typeof node.textContent === "string" && node.textContent.trim()) {
    parts.push(node.textContent.trim());
  }
  if (typeof node.innerHTML === "string" && node.innerHTML.trim()) {
    parts.push(node.innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  for (const child of node.children || []) {
    const text = collectText(child);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(" ");
}

function findByAttr(node, attr, value) {
  if (!node) {
    return null;
  }
  if (node.getAttribute?.(attr) === value) {
    return node;
  }
  for (const child of node.children || []) {
    const match = findByAttr(child, attr, value);
    if (match) {
      return match;
    }
  }
  return null;
}

test("tier snapshots reflect guest/free/standard/pro from backend state", () => {
  const documentRef = new FakeDocument();
  const popupRoot = documentRef.createElement("div");
  const sidepanelRoot = documentRef.createElement("div");

  renderPopupAuthSnapshot(popupRoot, { status: "signed_out" });
  renderSidepanelAuthSnapshot(sidepanelRoot, { status: "signed_out" });
  assert.match(collectText(popupRoot), /Tier guest/);
  assert.match(collectText(sidepanelRoot), /Tier: guest/);

  for (const tier of ["free", "standard", "pro"]) {
    const snapshot = {
      status: "signed_in",
      session: { email: `${tier}@example.com` },
      bootstrap: {
        profile: { display_name: `${tier} user` },
        entitlement: { tier, status: "active" },
        capabilities: {
          citation_styles: tier === "free" ? ["apa", "mla"] : ["apa", "mla", "chicago", "harvard"],
          usage: {
            citations_per_week: tier === "pro" ? "unlimited" : "10",
            notes_per_week: tier === "standard" ? null : "4",
          },
        },
        app: { handoff: { preferred_destination: "/editor" } },
        taxonomy: { recent_projects: [], recent_tags: [] },
      },
    };
    const surface = normalizeCapabilitySurface({ auth: snapshot });
    assert.equal(surface.tier, tier);
    const root = documentRef.createElement("div");
    renderSidepanelAuthSnapshot(root, snapshot);
    assert.match(collectText(root), new RegExp(`Tier: ${tier}`));
  }
});

test("usage summary hides missing values and stays compact", () => {
  const documentRef = new FakeDocument();
  const usageSummary = createUsageSummaryList({ documentRef });
  usageSummary.render([
    { label: "Citations /week", value: "10" },
    { label: "Notes /week", value: "" },
    { label: "History", value: null },
    { label: "Exports", value: "Enabled" },
  ]);
  const text = collectText(usageSummary.root);
  assert.match(text, /Citations \/week 10/);
  assert.match(text, /Exports Enabled/);
  assert.doesNotMatch(text, /Notes \/week/);
  assert.doesNotMatch(text, /History/);
});

test("locked actions and modal style locks render from backend-driven state", () => {
  const documentRef = new FakeDocument();
  const menu = createSelectionMenu({
    documentRef,
    actions: [
      { key: "copy", label: "Copy", active: true, locked: false },
      { key: "cite", label: "Cite", active: false, locked: true },
    ],
  });
  const citeButton = findByAttr(menu.root, "data-selection-action", "cite");
  assert.equal(citeButton.getAttribute("data-locked"), "true");
  assert.equal(citeButton.disabled, true);
  assert.match(collectText(citeButton), /Locked/);

  const modalRoot = documentRef.createElement("div");
  renderCitationModal(modalRoot, {
    tier: "free",
    citation: {
      id: "citation-1",
      metadata: { title: "Source Title", canonical_url: "https://example.com" },
      source: { author: "Author" },
    },
    selected_style: "apa",
    selected_format: "bibliography",
    locked_styles: ["chicago", "harvard"],
  }, { documentRef, navigatorRef: { clipboard: { async writeText() {} } } });
  const chicago = findByAttr(modalRoot, "data-style", "chicago");
  assert.equal(chicago.getAttribute("data-locked"), "true");
  assert.match(collectText(modalRoot), /Some citation styles are locked for this account/);
  assert.match(collectText(modalRoot), /Free/);
});
