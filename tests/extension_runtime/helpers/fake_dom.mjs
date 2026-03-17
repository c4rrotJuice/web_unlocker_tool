class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.shadowRoot = null;
    this.attributes = new Map();
    this.className = "";
    this.innerHTML = "";
    this.id = "";
    this.dataset = {};
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
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

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    return this._walk(this.documentElement).find((node) => node.id === id) || null;
  }

  querySelector(selector) {
    const attrMatch = selector.match(/^\[(.+?)="(.+?)"\]$/);
    if (!attrMatch) return null;
    const [, name, value] = attrMatch;
    return this._walk(this.documentElement).find((node) => node.getAttribute(name) === value) || null;
  }

  _walk(root) {
    const nodes = [root];
    for (const child of root.children) {
      nodes.push(...this._walk(child));
    }
    return nodes;
  }
}

export function installFakeDom() {
  const document = new FakeDocument();
  globalThis.document = document;
  return document;
}
