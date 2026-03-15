(function attachEditorSessionRuntime(global) {
  const runtime = global.WritiorEditorRuntime;
  if (!runtime || typeof runtime.register !== "function") {
    throw new Error("[editor] Runtime core must load before editor session runtime");
  }

  function createEditorSessionRuntime(quill) {
    let lastKnownRange = null;
    let lastActiveParagraphNode = null;

    function resetForDocumentSwitch() {
      lastKnownRange = null;
      if (lastActiveParagraphNode) {
        lastActiveParagraphNode.classList.remove("is-active-paragraph");
        lastActiveParagraphNode = null;
      }
    }

    function rememberRange(range) {
      if (range) lastKnownRange = { index: range.index, length: range.length };
    }

    function getRange() {
      return lastKnownRange ? { index: lastKnownRange.index, length: lastKnownRange.length } : null;
    }

    function focusAndResolveInsertionIndex() {
      const current = quill.getSelection();
      if (current) {
        rememberRange(current);
        return current.index;
      }
      if (lastKnownRange && typeof lastKnownRange.index === "number") {
        quill.focus();
        quill.setSelection(lastKnownRange.index, lastKnownRange.length || 0, "silent");
        return lastKnownRange.index;
      }
      const length = Math.max(0, quill.getLength() - 1);
      quill.focus();
      quill.setSelection(length, 0, "silent");
      lastKnownRange = { index: length, length: 0 };
      return length;
    }

    function setSelection(index, length, source) {
      quill.setSelection(index, length || 0, source || "silent");
      lastKnownRange = { index, length: length || 0 };
    }

    function highlightActiveLine(range) {
      if (lastActiveParagraphNode) {
        lastActiveParagraphNode.classList.remove("is-active-paragraph");
        lastActiveParagraphNode = null;
      }
      if (!range) return;
      const line = quill.getLine(range.index)?.[0];
      const node = line?.domNode || null;
      if (node) {
        node.classList.add("is-active-paragraph");
        lastActiveParagraphNode = node;
      }
    }

    return {
      resetForDocumentSwitch,
      rememberRange,
      getRange,
      focusAndResolveInsertionIndex,
      setSelection,
      highlightActiveLine,
    };
  }

  runtime.register("editorSession", createEditorSessionRuntime);
})(window);
