import { renderCitationModal } from "../../sidepanel/app/citation_modal.js";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
export function createCitationModalHost({ documentRef = globalThis.document, onRequestPreview, onRequestRender, onSave, onDismiss, navigatorRef = globalThis.navigator, } = {}) {
    const host = documentRef.createElement("div");
    const backdrop = documentRef.createElement("div");
    const surface = documentRef.createElement("div");
    host.setAttribute(EXTENSION_UI_ATTR, "true");
    host.setAttribute("data-citation-modal-host", "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.display = "none";
    host.style.pointerEvents = "none";
    backdrop.setAttribute(EXTENSION_UI_ATTR, "true");
    backdrop.style.position = "absolute";
    backdrop.style.inset = "0";
    backdrop.style.background = "rgba(2, 6, 23, 0.38)";
    backdrop.style.pointerEvents = "auto";
    surface.setAttribute(EXTENSION_UI_ATTR, "true");
    surface.style.position = "absolute";
    surface.style.top = "50%";
    surface.style.left = "50%";
    surface.style.transform = "translate(-50%, -50%)";
    surface.style.width = "min(560px, calc(100vw - 24px))";
    surface.style.maxHeight = "calc(100vh - 24px)";
    surface.style.overflow = "auto";
    surface.style.pointerEvents = "auto";
    if (typeof host.append === "function") {
        host.append(backdrop, surface);
    }
    else {
        host.appendChild(backdrop);
        host.appendChild(surface);
    }
    let visible = false;
    let modal = null;
    function ensureMounted() {
        if (host.parentNode || host.parentElement) {
            return;
        }
        (documentRef.body || documentRef.documentElement)?.appendChild(host);
    }
    function render(snapshot) {
        ensureMounted();
        visible = true;
        host.style.display = "block";
        modal = renderCitationModal(surface, snapshot, {
            documentRef,
            navigatorRef,
            onRequestPreview,
            onRequestRender,
            onSave,
            onDismiss,
        });
        return modal;
    }
    backdrop.addEventListener("click", (event) => {
        event.preventDefault?.();
        onDismiss?.();
    });
    return {
        host,
        surface,
        render,
        hide() {
            visible = false;
            host.style.display = "none";
            surface.innerHTML = "";
        },
        isVisible() {
            return visible;
        },
        isInside(target) {
            let current = target || null;
            while (current) {
                if (current === host || current === surface) {
                    return true;
                }
                if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
                    return true;
                }
                current = current.parentNode || current.parentElement || null;
            }
            return false;
        },
        getState() {
            return modal?.getState?.() || { visible };
        },
        destroy() {
            host.remove?.();
        },
    };
}
