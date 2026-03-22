export function isElementNode(node) {
  return Boolean(node) && typeof node === "object" && typeof node.tagName === "string";
}

export function isEditableElement(node) {
  if (!isElementNode(node)) {
    return false;
  }
  const tagName = String(node.tagName || "").toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (typeof node.isContentEditable === "boolean" && node.isContentEditable) {
    return true;
  }
  const contentEditable = typeof node.getAttribute === "function" ? node.getAttribute("contenteditable") : node.contentEditable;
  return contentEditable === "" || contentEditable === "true" || contentEditable === "plaintext-only";
}

export function getNodeLabel(node) {
  if (!isElementNode(node)) {
    return "";
  }
  const parts = [];
  if (typeof node.id === "string" && node.id) {
    parts.push(node.id);
  }
  if (typeof node.className === "string" && node.className) {
    parts.push(node.className);
  }
  if (typeof node.getAttribute === "function") {
    for (const key of ["aria-label", "title", "role", "data-testid", "data-test", "data-ad"]) {
      const value = node.getAttribute(key);
      if (value) {
        parts.push(value);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

export function walkElementTree(root, visit) {
  if (!root || typeof visit !== "function") {
    return;
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    visit(node);
    const children = node.children || node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
}

export function setImportantStyle(node, property, value) {
  if (!node) {
    return;
  }
  if (!node.style) {
    node.style = {};
  }
  node.style[property] = value;
}

export function getPositionHint(node, windowRef) {
  if (!node || typeof windowRef?.getComputedStyle !== "function") {
    return { position: "", zIndex: "", display: "", visibility: "" };
  }
  const computed = windowRef.getComputedStyle(node);
  return {
    position: String(computed?.position || ""),
    zIndex: String(computed?.zIndex || ""),
    display: String(computed?.display || ""),
    visibility: String(computed?.visibility || ""),
  };
}
