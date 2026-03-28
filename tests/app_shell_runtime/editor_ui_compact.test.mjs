import test from "node:test";
import assert from "node:assert/strict";

import { bindToolbarController } from "../../app/static/js/editor_v2/ui/toolbar_controller.js";
import { bindContextTabs } from "../../app/static/js/editor_v2/ui/context_tabs_controller.js";
import {
  renderDocumentList,
  renderExplorerLoading,
  renderExplorerState,
} from "../../app/static/js/editor_v2/ui/explorer_renderer.js";
import { createExplorerController } from "../../app/static/js/editor_v2/research/explorer_controller.js";
import { createWorkspaceState } from "../../app/static/js/editor_v2/core/workspace_state.js";

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
    querySelector() { return null; },
    closest(selector) {
      if (selector === "[data-toolbar-action]" && this.dataset?.toolbarAction) return this;
      return null;
    },
    querySelectorAll() { return []; },
  };
  return element;
}

test("toolbar keeps citation action without collapse state", () => {
  let citationCalls = 0;
  const toolbar = makeElement();
  const citationButton = makeElement({ dataset: { toolbarAction: "insert-citation" } });

  const controller = bindToolbarController({
    toolbar,
    focusTarget: { focus() {} },
    onInsertCitation() {
      citationCalls += 1;
    },
  });

  toolbar.dispatch("click", { target: citationButton });
  assert.equal(citationCalls, 1);
  assert.equal(toolbar.dataset.toolbarExpanded, undefined);

  controller.dispose();
});

test("context tabs notify active tab changes", () => {
  const citationsButton = makeElement({ dataset: { contextTab: "citations" } });
  const checkpointsButton = makeElement({ dataset: { contextTab: "checkpoints" } });
  const activations = [];

  bindContextTabs({
    buttons: [citationsButton, checkpointsButton],
    onChange(nextTab) {
      activations.push(nextTab);
    },
  });

  assert.deepEqual(activations, ["citations"]);

  checkpointsButton.dispatch("click", { target: checkpointsButton });
  assert.deepEqual(activations, ["citations", "checkpoints"]);
  assert.equal(checkpointsButton.getAttribute("aria-selected"), "true");
});

test("document explorer renders dense rows with preview payload", () => {
  const target = makeElement();
  renderDocumentList(target, [{ id: "doc-1", title: "Draft", summary: "Short summary" }], "doc-1");
  assert.match(target.innerHTML, /editor-v2-row/);
  assert.match(target.innerHTML, /data-preview=/);
  assert.match(target.innerHTML, /Draft/);
});

test("explorer loading and empty states render as compact list states", () => {
  const target = makeElement();
  renderExplorerLoading(target, "sources", 2);
  assert.match(target.innerHTML, /editor-v2-row-skeleton/);

  renderExplorerState(target, "No sources ready yet.");
  assert.match(target.innerHTML, /editor-v2-list-state/);
  assert.doesNotMatch(target.innerHTML, /editor-v2-card/);
});

test("explorer tab switch shows loading before fetch resolves", async () => {
  const workspaceState = createWorkspaceState();
  const refs = {
    explorerStatus: makeElement(),
    explorerList: makeElement(),
    explorerSearch: { value: "", addEventListener() {}, removeEventListener() {}, focus() {}, select() {} },
    explorerTabs: [],
  };
  let resolveExplorer = null;
  const pendingExplorer = new Promise((resolve) => {
    resolveExplorer = resolve;
  });
  const controller = createExplorerController({
    workspaceState,
    refs,
    renderers: {
      renderDocumentList() {},
      renderExplorerLoading: renderExplorerLoading,
      renderExplorerState: renderExplorerState,
    },
    hydrator: {
      hydrateExplorer() {
        return pendingExplorer;
      },
    },
    onOpenDocument() {},
    onFocusEntity() {},
    onEntityAction() {},
  });

  const pending = controller.beginEntityAction({ action: "insert", entityType: "citation" });
  assert.equal(refs.explorerStatus.textContent, "Loading");
  assert.match(refs.explorerList.innerHTML, /editor-v2-row-skeleton/);

  resolveExplorer([]);
  await pending;
});
