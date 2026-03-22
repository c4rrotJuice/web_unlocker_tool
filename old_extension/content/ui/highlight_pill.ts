import { createSelectionMenu } from "./selection_menu.ts";

const HOST_ID = "writior-selection-pill";
const HOST_ATTR = "data-writior-selection-pill-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function truncate(text, length = 120) {
  if (!text || text.length <= length) {
    return text || "";
  }
  return `${text.slice(0, length - 1)}…`;
}

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
      :host, :host * {
        box-sizing: border-box;
      }
      [data-selection-pill-panel="true"] {
        transition: transform 140ms ease, opacity 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
      }
      [data-selection-pill-panel="true"]:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.32);
      }
      [data-selection-menu="true"] button {
        transition: transform 120ms ease, border-color 120ms ease, background-color 120ms ease, opacity 120ms ease;
      }
      [data-selection-menu="true"] button:hover {
        transform: translateY(-1px);
      }
      [data-selection-menu="true"] button:focus-visible {
        outline: 2px solid rgba(96, 165, 250, 0.85);
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        [data-selection-pill-panel="true"],
        [data-selection-menu="true"] button {
          transition: none !important;
        }
        [data-selection-pill-panel="true"]:hover,
        [data-selection-menu="true"] button:hover {
          transform: none !important;
        }
      }
    `;
    root.appendChild(style);
  }
  return { host, root };
}

function createPanel(documentRef) {
  const panel = documentRef.createElement("div");
  panel.setAttribute("data-selection-pill-panel", "true");
  panel.style.position = "absolute";
  panel.style.pointerEvents = "auto";
  panel.style.maxWidth = "min(360px, calc(100vw - 24px))";
  panel.style.background = "rgba(17, 24, 39, 0.96)";
  panel.style.color = "#f9fafb";
  panel.style.border = "1px solid rgba(148, 163, 184, 0.28)";
  panel.style.boxShadow = "0 16px 40px rgba(15, 23, 42, 0.28)";
  panel.style.borderRadius = "16px";
  panel.style.padding = "10px 12px";
  panel.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  panel.style.fontSize = "13px";
  panel.style.lineHeight = "1.3";
  panel.style.display = "none";
  return panel;
}

export function createHighlightPill({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  onAction,
  onDismiss,
} = {}) {
  const { host, root } = createContainer(documentRef);
  const panel = createPanel(documentRef);
  panel.setAttribute("aria-live", "polite");
  const previewShell = documentRef.createElement("div");
  previewShell.setAttribute("data-selection-pill-preview-shell", "true");
  previewShell.style.display = "grid";
  previewShell.style.gap = "8px";
  previewShell.style.marginBottom = "8px";

  const statusRow = documentRef.createElement("div");
  statusRow.setAttribute("data-selection-pill-status", "true");
  statusRow.style.display = "flex";
  statusRow.style.alignItems = "center";
  statusRow.style.justifyContent = "space-between";
  statusRow.style.gap = "8px";
  statusRow.style.fontSize = "11px";
  statusRow.style.letterSpacing = "0.04em";
  statusRow.style.textTransform = "uppercase";
  statusRow.style.color = "#94a3b8";

  const statusLabel = documentRef.createElement("span");
  statusLabel.textContent = "Selection active";
  const shortcutHint = documentRef.createElement("span");
  shortcutHint.textContent = "Esc dismiss";

  const preview = documentRef.createElement("div");
  preview.setAttribute("data-selection-preview", "true");
  preview.style.maxWidth = "100%";
  preview.style.overflow = "hidden";
  preview.style.textOverflow = "ellipsis";
  preview.style.whiteSpace = "nowrap";
  preview.style.opacity = "0.92";

  const menu = createSelectionMenu({
    documentRef,
    onAction: (key) => onAction?.(key),
  });
  statusRow.appendChild(statusLabel);
  statusRow.appendChild(shortcutHint);
  previewShell.appendChild(statusRow);
  previewShell.appendChild(preview);
  panel.appendChild(previewShell);
  panel.appendChild(menu.root);
  if (root !== host) {
    root.appendChild(panel);
  } else {
    host.appendChild(panel);
  }

  let visible = false;
  let lastSnapshot = null;
  let lastMessage = "";
  let currentPosition = null;

  function ensureMounted() {
    if (host.parentNode || host.parentElement) {
      return;
    }
    (documentRef.body || documentRef.documentElement)?.appendChild(host);
  }

  function setMessage(message) {
    lastMessage = message || "";
    menu.setStatus(lastMessage || "Copy");
  }

  function updatePosition(rect) {
    if (!rect) {
      return;
    }
    const viewportWidth = Number(windowRef?.innerWidth || 1024);
    const viewportHeight = Number(windowRef?.innerHeight || 768);
    const width = panel.getBoundingClientRect?.().width || 280;
    const above = rect.top - 12;
    const below = rect.bottom + 12;
    const preferAbove = above > 48;
    const top = clamp(preferAbove ? above - 52 : below, 8, viewportHeight - 72);
    const left = clamp(rect.left + rect.width / 2 - width / 2, 8, viewportWidth - width - 8);
    currentPosition = { top, left };
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function render(snapshot) {
    lastSnapshot = snapshot;
    panel.setAttribute("data-focus-mode", snapshot?.ui?.focus_mode ? "true" : "false");
    preview.textContent = truncate(snapshot?.selection?.normalized_text || snapshot?.selection?.text || "");
    statusLabel.textContent = snapshot?.ui?.focus_mode ? "Focus mode" : "Selection active";
    shortcutHint.textContent = "Esc dismiss";
    setMessage("Copy");
    if (snapshot?.actions) {
      menu.setActions(snapshot.actions);
    }
    updatePosition(snapshot?.selection?.rect || null);
    ensureMounted();
    host.style.display = "block";
    panel.style.display = "block";
    visible = true;
    return api.getState();
  }

  function hide(reason = "dismiss") {
    visible = false;
    host.style.display = "none";
    panel.style.display = "none";
    host.remove?.();
    onDismiss?.(reason);
  }

  function flash(message, duration = 1200) {
    setMessage(message);
    if (duration > 0) {
      windowRef?.setTimeout?.(() => {
        if (visible) {
          setMessage("Copy");
        }
      }, duration);
    }
  }

  function destroy() {
    host.remove?.();
    visible = false;
    lastSnapshot = null;
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

  const api = {
    host,
    panel,
    root,
    render,
    hide,
    flash,
    destroy,
    isVisible: () => visible,
    isInsidePill,
    getState: () => ({
      visible,
      lastMessage,
      position: currentPosition,
      previewText: preview.textContent || "",
    }),
    setActionSuccess(message = "Saved") {
      flash(message);
    },
    setActionFailure(message = "Failed") {
      flash(message);
    },
    setCopySuccess() {
      flash("Copied");
    },
    setCopyFailure() {
      flash("Copy failed");
    },
  };

  panel.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  return api;
}
