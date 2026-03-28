// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createHoverPreviewPane } from "./hover_preview_pane.js";
export function createListPane({ documentRef = globalThis.document } = {}) {
    const root = documentRef.createElement("section");
    root.setAttribute("data-list-pane", "true");
    root.style.position = "relative";
    root.style.minHeight = "0";
    root.style.height = "100%";
    root.style.overflow = "hidden";
    const preview = createHoverPreviewPane({ documentRef });
    const scroll = documentRef.createElement("div");
    scroll.setAttribute("data-list-scroll", "true");
    scroll.style.position = "relative";
    scroll.style.height = "100%";
    scroll.style.overflow = "auto";
    scroll.style.padding = "8px";
    scroll.style.display = "grid";
    scroll.style.alignContent = "start";
    scroll.style.gap = "8px";
    root.append(preview.root, scroll);
    function setContent(nodes = []) {
        scroll.replaceChildren(...nodes);
    }
    return { root, scroll, preview, setContent };
}
