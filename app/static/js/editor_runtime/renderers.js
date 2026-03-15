(function attachContainedRenderers(global) {
  const runtime = global.WritiorEditorRuntime;
  if (!runtime || typeof runtime.register !== "function") {
    throw new Error("[editor] Runtime core must load before renderers runtime");
  }

  function createContainedRenderers(instrumentation) {
    function createKeyedContainerRenderer(container, options) {
      const itemKey = options.itemKey;
      const renderItem = options.renderItem;
      const emptyState = options.emptyState;
      const signatureFn = options.signature || ((value) => JSON.stringify(value));
      const nodes = new Map();
      let lastSignature = "";

      function render(items) {
        const nextItems = items || [];
        const signature = signatureFn(nextItems);
        if (signature === lastSignature) return false;
        lastSignature = signature;
        instrumentation.increment(`render:${container.id || "anonymous"}`);

        const nextKeys = new Set();
        nextItems.forEach((item) => {
          const key = itemKey(item);
          nextKeys.add(key);
          const existing = nodes.get(key);
          const nextNode = renderItem(item, existing || null);
          if (!existing) {
            nodes.set(key, nextNode);
            container.appendChild(nextNode);
          } else if (existing !== nextNode) {
            container.replaceChild(nextNode, existing);
            nodes.set(key, nextNode);
          }
        });

        Array.from(nodes.keys()).forEach((key) => {
          if (nextKeys.has(key)) return;
          const node = nodes.get(key);
          node?.remove();
          nodes.delete(key);
        });

        nextItems.forEach((item) => {
          const key = itemKey(item);
          const node = nodes.get(key);
          if (node && node.parentNode !== container) {
            container.appendChild(node);
          } else if (node) {
            container.appendChild(node);
          }
        });

        if (!nextItems.length) {
          container.innerHTML = emptyState;
          nodes.clear();
        } else if (container.innerHTML === emptyState) {
          container.innerHTML = "";
          nextItems.forEach((item) => {
            const key = itemKey(item);
            const node = nodes.get(key);
            if (node) container.appendChild(node);
          });
        }

        return true;
      }

      return { render };
    }

    return {
      createKeyedContainerRenderer,
    };
  }

  runtime.register("renderers", createContainedRenderers);
})(window);
