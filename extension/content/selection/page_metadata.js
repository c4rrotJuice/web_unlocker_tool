// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
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
    let found = "";
    walkElements(documentRef?.head || documentRef?.documentElement || documentRef?.body || null, (node) => {
        if (found || typeof node?.tagName !== "string" || String(node.tagName).toUpperCase() !== "META") {
            return;
        }
        const name = String(typeof node.getAttribute === "function" ? node.getAttribute("name") : node.name || "");
        const property = String(typeof node.getAttribute === "function" ? node.getAttribute("property") : node.property || "");
        if (match(name.toLowerCase(), property.toLowerCase())) {
            const content = typeof node.getAttribute === "function" ? node.getAttribute("content") : node.content;
            found = content ? String(content).trim() : "";
        }
    });
    return found;
}
function readLink(documentRef, relValue) {
    let found = "";
    walkElements(documentRef?.head || documentRef?.documentElement || documentRef?.body || null, (node) => {
        if (found || typeof node?.tagName !== "string" || String(node.tagName).toUpperCase() !== "LINK") {
            return;
        }
        const rel = String(typeof node.getAttribute === "function" ? node.getAttribute("rel") : node.rel || "").toLowerCase();
        if (rel === relValue) {
            const href = typeof node.getAttribute === "function" ? node.getAttribute("href") : node.href;
            found = href ? String(href) : "";
        }
    });
    return found;
}
export function extractPageMetadata({ documentRef = globalThis.document, windowRef = globalThis.window, } = {}) {
    const url = String(windowRef?.location?.href || "");
    const title = String(documentRef?.title
        || readMeta(documentRef, (name, property) => name === "title" || property === "og:title")
        || "").trim();
    const description = readMeta(documentRef, (name, property) => name === "description" || property === "og:description");
    const author = readMeta(documentRef, (name, property) => name === "author" || property === "article:author");
    const site_name = readMeta(documentRef, (_name, property) => property === "og:site_name");
    const canonical_url = readLink(documentRef, "canonical");
    const language = String(documentRef?.documentElement?.lang || "");
    let origin = "";
    let host = "";
    try {
        const parsed = url ? new URL(url) : null;
        origin = parsed?.origin || "";
        host = parsed?.host || "";
    }
    catch { }
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
