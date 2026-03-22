// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { computePillPosition } from "../selection/position.js";
import { createSelectionMenuButton } from "./selection_menu_button.js";
const HOST_ID = "writior-selection-pill";
const HOST_ATTR = "data-writior-selection-pill-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
function createContainer(documentRef) {
    const host = documentRef.createElement("div");
    host.id = HOST_ID;
    host.setAttribute(HOST_ATTR, "true");
    host.setAttribute(EXTENSION_UI_ATTR, "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.style.display = "none";
    const root = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
    if (root && root !== host) {
        const style = documentRef.createElement("style");
        style.textContent = `
      :host, :host * { box-sizing: border-box; }
      [data-selection-pill-panel="true"] button:focus-visible {
        outline: 2px solid rgba(191, 219, 254, 0.9);
        outline-offset: 2px;
      }
    `;
        root.appendChild(style);
    }
    return { host, root };
}
function createPanel(documentRef) {
    const panel = documentRef.createElement("div");
    panel.setAttribute("data-selection-pill-panel", "true");
    panel.setAttribute(EXTENSION_UI_ATTR, "true");
    panel.style.position = "absolute";
    panel.style.display = "none";
    panel.style.pointerEvents = "auto";
    panel.style.minWidth = "auto";
    panel.style.maxWidth = "calc(100vw - 16px)";
    panel.style.padding = "6px";
    panel.style.borderRadius = "999px";
    panel.style.border = "1px solid rgba(148, 163, 184, 0.26)";
    panel.style.background = "rgba(15, 23, 42, 0.96)";
    panel.style.color = "#f8fafc";
    panel.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.2)";
    panel.style.fontFamily = "Georgia, 'Times New Roman', serif";
    panel.style.fontSize = "12px";
    panel.style.lineHeight = "1";
    return panel;
}
export function createSelectionActionPill({ documentRef = globalThis.document, windowRef = globalThis.window, onAction, onDismiss, }) {
    const { host, root } = createContainer(documentRef);
    const panel = createPanel(documentRef);
    const menu = documentRef.createElement("div");
    menu.setAttribute("data-selection-menu", "true");
    menu.style.display = "flex";
    menu.style.gap = "6px";
    menu.style.alignItems = "center";
    menu.style.flexWrap = "wrap";
    panel.appendChild(menu);
    if (root !== host) {
        root.appendChild(panel);
    }
    else {
        host.appendChild(panel);
    }
    let visible = false;
    let currentPosition = null;
    let lastMessage = "";
    let resetTimer = null;
    function ensureMounted() {
        if (host.parentNode || host.parentElement) {
            return;
        }
        (documentRef.body || documentRef.documentElement)?.appendChild(host);
    }
    function setButtons(actions = []) {
        menu.innerHTML = "";
        if (Array.isArray(menu.children)) {
            menu.children.length = 0;
        }
        actions
            .filter((action) => action?.active !== false || action?.locked === true)
            .forEach((action) => {
            menu.appendChild(createSelectionMenuButton({ documentRef, action, onAction }));
        });
    }
    function updatePosition(rect) {
        const panelRect = typeof panel.getBoundingClientRect === "function"
            ? panel.getBoundingClientRect()
            : { width: 188, height: 84 };
        currentPosition = computePillPosition({
            rect,
            viewportWidth: Number(windowRef?.innerWidth || 1024),
            viewportHeight: Number(windowRef?.innerHeight || 768),
            panelWidth: Number(panelRect?.width || 188),
            panelHeight: Number(panelRect?.height || 84),
        });
        panel.style.top = `${currentPosition.top}px`;
        panel.style.left = `${currentPosition.left}px`;
    }
    function setMessage(message) {
        lastMessage = message || "";
        const copyButton = Array.from(menu.children || []).find((node) => node.getAttribute?.("data-selection-action") === "copy");
        if (copyButton) {
            copyButton.textContent = lastMessage || "Copy";
        }
    }
    function flash(message, duration = 1200) {
        if (resetTimer) {
            windowRef?.clearTimeout?.(resetTimer);
            resetTimer = null;
        }
        setMessage(message);
        if (duration > 0) {
            resetTimer = windowRef?.setTimeout?.(() => {
                resetTimer = null;
                if (visible) {
                    setMessage("Copy");
                }
            }, duration) || null;
        }
    }
    function render(snapshot) {
        ensureMounted();
        setButtons(snapshot?.actions || []);
        host.style.display = "block";
        panel.style.display = "block";
        visible = true;
        setMessage("Copy");
        updatePosition(snapshot?.selection?.rect || null);
        return getState();
    }
    function hide(reason = "dismiss") {
        visible = false;
        if (resetTimer) {
            windowRef?.clearTimeout?.(resetTimer);
            resetTimer = null;
        }
        host.style.display = "none";
        panel.style.display = "none";
        onDismiss?.(reason);
    }
    function destroy() {
        hide("destroy");
        host.remove?.();
    }
    function isInsidePill(target) {
        let current = target || null;
        while (current) {
            if (current === host || current === panel || current === root) {
                return true;
            }
            if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
                return true;
            }
            current = current.parentNode || current.parentElement || null;
        }
        return false;
    }
    function getState() {
        return {
            visible,
            position: currentPosition,
            previewText: "",
            lastMessage,
        };
    }
    panel.addEventListener("click", (event) => {
        event.stopPropagation?.();
    });
    return {
        host,
        panel,
        render,
        hide,
        destroy,
        flash,
        isInsidePill,
        isVisible: () => visible,
        getState,
        setCopySuccess() {
            flash("Copied");
        },
        setCopyFailure() {
            flash("Copy failed");
        },
    };
}
