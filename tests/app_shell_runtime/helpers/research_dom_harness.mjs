class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  _sync() {
    this.element._className = Array.from(this.values).join(" ");
  }

  setFromString(value) {
    this.values = new Set(String(value || "").split(/\s+/).filter(Boolean));
    this._sync();
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(token));
    this._sync();
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
    this._sync();
  }

  toggle(token, force) {
    if (force === true) {
      this.values.add(token);
    } else if (force === false) {
      this.values.delete(token);
    } else if (this.values.has(token)) {
      this.values.delete(token);
    } else {
      this.values.add(token);
    }
    this._sync();
    return this.values.has(token);
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeStyle {
  constructor() {
    this.properties = new Map();
  }

  setProperty(name, value) {
    this.properties.set(name, String(value));
  }
}

function toDatasetKey(name) {
  return String(name || "").replace(/^data-/, "").replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function matchesSelector(node, selector) {
  if (!node) return false;
  if (selector.startsWith(".")) {
    return node.classList.contains(selector.slice(1));
  }
  if (selector.startsWith("#")) {
    return node.id === selector.slice(1);
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const content = selector.slice(1, -1);
    const [rawName, rawValue] = content.split("=");
    const name = rawName.trim();
    if (rawValue === undefined) {
      return node.getAttribute(name) !== null;
    }
    const value = rawValue.trim().replace(/^"|"$/g, "");
    return node.getAttribute(name) === value;
  }
  return node.tagName.toLowerCase() === selector.toLowerCase();
}

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.eventListeners = new Map();
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
    this._className = "";
    this._innerHTML = "";
    this.id = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = 0;
    this.textContent = "";
    this.virtualChildren = [];
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this.classList.setFromString(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value || "");
    this.virtualChildren = this._parseVirtualChildren(this._innerHTML);
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "id") {
      this.id = stringValue;
    } else if (name === "class") {
      this.className = stringValue;
    } else if (name === "hidden") {
      this.hidden = true;
    } else if (name.startsWith("data-")) {
      this.dataset[toDatasetKey(name)] = stringValue;
    }
  }

  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    if (name.startsWith("data-")) {
      const key = toDatasetKey(name);
      return Object.hasOwn(this.dataset, key) ? this.dataset[key] : null;
    }
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

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  replaceChildren(...children) {
    this.children = [];
    this.textContent = children.map((child) => child?.textContent || "").join("");
    children.forEach((child) => {
      if (child instanceof FakeNode) {
        this.appendChild(child);
      }
    });
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    this.eventListeners.set(type, listeners.filter((entry) => entry !== listener));
  }

  dispatchEvent(event) {
    const target = event?.target || this;
    const payload = {
      ...event,
      type: event?.type || "event",
      target,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    let node = this;
    while (node) {
      const listeners = node.eventListeners.get(payload.type) || [];
      for (const listener of listeners) {
        listener({ ...payload, currentTarget: node, target });
      }
      node = node.parentNode;
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click", target: this });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const allChildren = [...this.children, ...this.virtualChildren];
    for (const child of allChildren) {
      if (matchesSelector(child, selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    if (!matches.length && selector === ".writior-toast__title span" && this.innerHTML.includes("writior-toast__title")) {
      const span = new FakeNode("span", this.ownerDocument);
      span.parentNode = this;
      return [span];
    }
    return matches;
  }

  _parseVirtualChildren(html) {
    const nodes = [];
    const tagPattern = /<([a-z0-9-]+)([^>]*)>/gi;
    let match = tagPattern.exec(html);
    while (match) {
      const [, tagName, rawAttrs] = match;
      const node = new FakeNode(tagName, this.ownerDocument);
      node.parentNode = this;
      const attrPattern = /([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g;
      let attrMatch = attrPattern.exec(rawAttrs);
      while (attrMatch) {
        const [, name, value = ""] = attrMatch;
        node.setAttribute(name, value);
        attrMatch = attrPattern.exec(rawAttrs);
      }
      nodes.push(node);
      match = tagPattern.exec(html);
    }
    return nodes;
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super("document", null);
    this.ownerDocument = this;
    this.activeElement = null;
    this.documentElement = new FakeNode("html", this);
    this.head = new FakeNode("head", this);
    this.body = new FakeNode("body", this);
    this.documentElement.append(this.head, this.body);
    this.children = [this.documentElement];
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  createTextNode(text) {
    return { textContent: String(text || "") };
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

function createResponse({ status = 200, body = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

export function createResearchHarness({ initialSearch = "" } = {}) {
  const document = new FakeDocument();
  const windowListeners = new Map();
  const requests = [];
  const routeHandlers = [];
  const location = {
    pathname: "/research",
    search: initialSearch,
    href: `/research${initialSearch}`,
  };

  const window = {
    document,
    location,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      windowListeners.set(type, listeners.filter((entry) => entry !== listener));
    },
    dispatchEvent(event) {
      const listeners = windowListeners.get(event.type) || [];
      listeners.forEach((listener) => listener(event));
    },
    history: {
      pushState(_state, _title, url) {
        const parsed = new URL(url, "https://example.com");
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.href = `${parsed.pathname}${parsed.search}`;
      },
      replaceState(_state, _title, url) {
        const parsed = new URL(url, "https://example.com");
        location.pathname = parsed.pathname;
        location.search = parsed.search;
        location.href = `${parsed.pathname}${parsed.search}`;
      },
    },
    webUnlockerAuth: {
      async authFetch(path) {
        requests.push(path);
        const handler = routeHandlers.find((entry) => entry.match(path));
        if (!handler) {
          throw new Error(`No mock handler for ${path}`);
        }
        return handler.handle(path);
      },
    },
    webUnlockerUI: {
      mapApiError(payload) {
        return payload?.detail ? { message: payload.detail } : null;
      },
    },
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  if (!globalThis.crypto?.randomUUID) {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "runtime-uuid" },
      configurable: true,
    });
  }

  const frame = document.createElement("div");
  frame.className = "app-content-frame";
  document.body.appendChild(frame);

  const tablist = document.createElement("div");
  tablist.id = "research-tablist";
  frame.appendChild(tablist);

  for (const tab of ["sources", "citations", "quotes", "notes"]) {
    const button = document.createElement("button");
    button.setAttribute("data-tab", tab);
    tablist.appendChild(button);
  }

  const form = document.createElement("form");
  form.id = "research-filters";
  frame.appendChild(form);

  const queryInput = document.createElement("input");
  queryInput.id = "research-query";
  form.appendChild(queryInput);

  const projectInput = document.createElement("input");
  projectInput.id = "research-project-filter";
  form.appendChild(projectInput);

  const tagInput = document.createElement("input");
  tagInput.id = "research-tag-filter";
  form.appendChild(tagInput);

  const closeButton = document.createElement("button");
  closeButton.id = "research-context-close";
  frame.appendChild(closeButton);

  const listRegion = document.createElement("div");
  listRegion.id = "research-list-region";
  frame.appendChild(listRegion);

  const contextPanel = document.createElement("aside");
  contextPanel.id = "research-context-panel";
  frame.appendChild(contextPanel);

  const contextTitle = document.createElement("h2");
  contextTitle.id = "research-context-title";
  contextPanel.appendChild(contextTitle);

  const contextBody = document.createElement("div");
  contextBody.id = "research-context-body";
  contextPanel.appendChild(contextBody);

  function route(match, handle) {
    routeHandlers.push({
      match: typeof match === "function" ? match : (path) => path === match,
      async handle(path) {
        const result = await handle(path);
        return createResponse(result);
      },
    });
  }

  function getTabButton(tab) {
    return tablist.querySelectorAll("[data-tab]").find((button) => button.dataset.tab === tab) || null;
  }

  return {
    document,
    window,
    requests,
    route,
    elements: {
      frame,
      tablist,
      form,
      queryInput,
      projectInput,
      tagInput,
      closeButton,
      listRegion,
      contextPanel,
      contextTitle,
      contextBody,
    },
    getTabButton,
  };
}
