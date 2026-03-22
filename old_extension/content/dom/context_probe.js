import { isEditableElement, isElementNode, getNodeLabel } from "../utils/dom_utils.js";

export function probePageContext({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const reasons = [];
  const root = documentRef?.documentElement || null;
  const body = documentRef?.body || null;
  const rootLabel = getNodeLabel(root);
  const bodyLabel = getNodeLabel(body);

  if (root && typeof root.getAttribute === "function" && root.getAttribute("style")) {
    const style = String(root.getAttribute("style") || "").toLowerCase();
    if (style.includes("user-select: none")) {
      reasons.push("root-user-select-none");
    }
  }
  if (body && typeof body.getAttribute === "function" && body.getAttribute("style")) {
    const style = String(body.getAttribute("style") || "").toLowerCase();
    if (style.includes("user-select: none")) {
      reasons.push("body-user-select-none");
    }
  }

  if (rootLabel.includes("no-select") || bodyLabel.includes("no-select")) {
    reasons.push("blocked-selection-class");
  }
  if (typeof body?.oncontextmenu === "function" || typeof root?.oncontextmenu === "function") {
    reasons.push("contextmenu-handler");
  }
  if (typeof body?.oncopy === "function" || typeof root?.oncopy === "function") {
    reasons.push("copy-handler");
  }

  const activeElement = documentRef?.activeElement || null;
  const editableSurface = isElementNode(activeElement) && isEditableElement(activeElement);
  const hostIsInteractive = Boolean(editableSurface);
  const isLikelyHostile = reasons.length > 0;

  return {
    hostIsInteractive,
    isLikelyHostile,
    reasons,
    canRunUnlocks: !hostIsInteractive,
    location: windowRef?.location?.href || "",
  };
}
