// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
const HOST_ATTR = "data-writior-toast-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
export function createContentToastController({ documentRef = globalThis.document, windowRef = globalThis.window, } = {}) {
    let host = null;
    let timer = null;
    function ensureHost() {
        if (host) {
            return host;
        }
        if (!documentRef?.body) {
            return null;
        }
        host = documentRef.createElement("div");
        host.setAttribute(HOST_ATTR, "true");
        host.setAttribute(EXTENSION_UI_ATTR, "true");
        host.style.position = "fixed";
        host.style.right = "12px";
        host.style.bottom = "12px";
        host.style.zIndex = "2147483647";
        host.style.pointerEvents = "none";
        host.style.fontFamily = "Georgia, 'Times New Roman', serif";
        documentRef.body.appendChild(host);
        return host;
    }
    function hide() {
        if (timer) {
            windowRef?.clearTimeout?.(timer);
            timer = null;
        }
        if (host) {
            host.innerHTML = "";
        }
    }
    function show(message, { duration = 1400 } = {}) {
        const target = ensureHost();
        if (!target) {
            return { visible: false };
        }
        hide();
        const bubble = documentRef.createElement("div");
        bubble.setAttribute(EXTENSION_UI_ATTR, "true");
        bubble.textContent = message;
        bubble.style.background = "rgba(15, 23, 42, 0.96)";
        bubble.style.color = "#f8fafc";
        bubble.style.border = "1px solid rgba(148, 163, 184, 0.22)";
        bubble.style.borderRadius = "999px";
        bubble.style.padding = "7px 10px";
        bubble.style.fontSize = "12px";
        bubble.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.22)";
        target.appendChild(bubble);
        timer = windowRef?.setTimeout?.(() => hide(), duration) || null;
        return { visible: true };
    }
    return {
        show,
        hide,
        destroy() {
            hide();
            host?.remove?.();
            host = null;
        },
    };
}
