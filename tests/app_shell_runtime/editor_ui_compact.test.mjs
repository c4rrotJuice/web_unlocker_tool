import test from "node:test";
import assert from "node:assert/strict";

import { bindToolbarController } from "../../app/static/js/editor_v2/ui/toolbar_controller.js";
import { bindContextTabs } from "../../app/static/js/editor_v2/ui/context_tabs_controller.js";
import { renderDocumentList } from "../../app/static/js/editor_v2/ui/explorer_renderer.js";

function makeElement({ dataset = {} } = {}) {
  const listeners = new Map();
  const element = {
    dataset: { ...dataset },
    hidden: false,
    innerHTML: "",
    textContent: "",
    attributes: new Map(),
    classList: {
      values: new Set(),
      toggle(value, force) {
        if (force === undefined) {
          if (this.values.has(value)) this.values.delete(value);
          else this.values.add(value);
          return;
        }
        if (force) this.values.add(value);
        else this.values.delete(value);
      },
      contains(value) {
        return this.values.has(value);
      },
    },
    addEventListener(type, handler) {
      const arr = listeners.get(type) || [];
      arr.push(handler);
      listeners.set(type, arr);
    },
    removeEventListener(type, handler) {
      const arr = listeners.get(type) || [];
      listeners.set(type, arr.filter((entry) => entry !== handler));
    },
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler({ ...event, target: event.target || element });
      }
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.get(name) || null;
    },
    querySelector(selector) {
      if (selector === '[data-toolbar-action="toggle-expand"]') return this.toggleButton || null;
      if (selector === '[data-toolbar-action="insert-citation"]') return this.citationButton || null;
      return null;
    },
    closest(selector) {
      if (selector === "[data-toolbar-action]" && this.dataset?.toolbarAction) return this;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-toolbar-group="advanced"]') return this.advancedGroups || [];
      return [];
    },
  };
  return element;
}

test("compact toolbar toggles advanced controls and citation action", () => {
  let citationCalls = 0;
  const toolbar = makeElement();
  const toggleButton = makeElement({ dataset: { toolbarAction: "toggle-expand" } });
  const citationButton = makeElement({ dataset: { toolbarAction: "insert-citation" } });
  const advanced = makeElement({ dataset: { toolbarGroup: "advanced" } });
  toolbar.toggleButton = toggleButton;
  toolbar.citationButton = citationButton;
  toolbar.advancedGroups = [advanced];

  const controller = bindToolbarController({
    toolbar,
    onInsertCitation() {
      citationCalls += 1;
    },
  });

  assert.equal(advanced.hidden, true);
  toolbar.dispatch("click", { target: toggleButton });
  assert.equal(toolbar.dataset.toolbarExpanded, "true");
  assert.equal(advanced.hidden, false);

  toolbar.dispatch("click", { target: citationButton });
  assert.equal(citationCalls, 1);

  controller.dispose();
});

test("context tabs keep a single visible pane", () => {
  const citationsButton = makeElement({ dataset: { contextTab: "citations" } });
  const checkpointsButton = makeElement({ dataset: { contextTab: "checkpoints" } });
  const citationsPane = makeElement({ dataset: { contextPane: "citations" } });
  const checkpointsPane = makeElement({ dataset: { contextPane: "checkpoints" } });

  bindContextTabs({
    buttons: [citationsButton, checkpointsButton],
    panes: [citationsPane, checkpointsPane],
  });

  assert.equal(citationsPane.hidden, false);
  assert.equal(checkpointsPane.hidden, true);

  checkpointsButton.dispatch("click", { target: checkpointsButton });
  assert.equal(citationsPane.hidden, true);
  assert.equal(checkpointsPane.hidden, false);
  assert.equal(checkpointsButton.getAttribute("aria-selected"), "true");
});

test("document explorer renders dense rows with preview payload", () => {
  const target = makeElement();
  renderDocumentList(target, [{ id: "doc-1", title: "Draft", summary: "Short summary" }], "doc-1");
  assert.match(target.innerHTML, /editor-v2-row/);
  assert.match(target.innerHTML, /data-preview=/);
  assert.match(target.innerHTML, /Draft/);
});
