function walkElements(root, visit) {
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

function readMeta(documentRef, match) {
  let found = null;
  walkElements(documentRef?.documentElement || documentRef?.body || null, (node) => {
    if (found || typeof node?.tagName !== "string" || String(node.tagName).toUpperCase() !== "META") {
      return;
    }
    const name = typeof node.getAttribute === "function" ? node.getAttribute("name") : node.name;
    const property = typeof node.getAttribute === "function" ? node.getAttribute("property") : node.property;
    if (match(name, property)) {
      found = typeof node.getAttribute === "function" ? node.getAttribute("content") : node.content;
    }
  });
  return found ? String(found) : "";
}

function readLink(documentRef, relValue) {
  let found = "";
  walkElements(documentRef?.documentElement || documentRef?.body || null, (node) => {
    if (found || typeof node?.tagName !== "string" || String(node.tagName).toUpperCase() !== "LINK") {
      return;
    }
    const rel = typeof node.getAttribute === "function" ? node.getAttribute("rel") : node.rel;
    if (String(rel || "").toLowerCase() === relValue) {
      const href = typeof node.getAttribute === "function" ? node.getAttribute("href") : node.href;
      found = href ? String(href) : "";
    }
  });
  return found;
}

export function extractPageMetadata({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const url = String(windowRef?.location?.href || "");
  const title = String(documentRef?.title || readMeta(documentRef, (name, property) => name === "title" || property === "og:title") || "").trim();
  const description = readMeta(documentRef, (name, property) => name === "description" || property === "og:description");
  const author = readMeta(documentRef, (name, property) => name === "author" || property === "article:author");
  const site_name = readMeta(documentRef, (_name, property) => property === "og:site_name");
  const canonical_url = readLink(documentRef, "canonical");
  const language = String(documentRef?.documentElement?.lang || "");
  const origin = (() => {
    try {
      return url ? new URL(url).origin : "";
    } catch {
      return "";
    }
  })();
  const host = (() => {
    try {
      return url ? new URL(url).host : "";
    } catch {
      return "";
    }
  })();

  return {
    url,
    origin,
    host,
    title,
    description,
    author,
    site_name,
    canonical_url,
    language,
  };
}
