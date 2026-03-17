import { FEEDBACK_CONSTANTS, TOAST_TYPES, getToastDefaults } from "./feedback_tokens.js";

const STYLE_ID = "writior-feedback-style";

function iconFor(type) {
  const icon = getToastDefaults(type).icon;
  if (icon === "check-circle") return "✓";
  if (icon === "alert-circle") return "!";
  if (icon === "alert-triangle") return "△";
  return "i";
}

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .writior-toast-region {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483000;
      width: min(360px, calc(100vw - 24px));
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .writior-toast-live {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      border: 0;
    }
    .writior-toast {
      pointer-events: auto;
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-left: 4px solid var(--toast-accent);
      background: var(--toast-background);
      box-shadow: 0 12px 32px rgba(2, 6, 23, 0.28);
      color: #f8fafc;
      opacity: 1;
      transform: translateX(0);
      transition: opacity ${FEEDBACK_CONSTANTS.EXIT_MS}ms ease, transform ${FEEDBACK_CONSTANTS.ENTER_MS}ms ease;
    }
    .writior-toast.is-entering,
    .writior-toast.is-exiting {
      opacity: 0;
      transform: translateX(20px);
    }
    @media (prefers-reduced-motion: reduce) {
      .writior-toast {
        transition: none;
      }
    }
    .writior-toast__icon {
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.14);
      font-size: 12px;
      font-weight: 700;
    }
    .writior-toast__content {
      min-width: 0;
      display: grid;
      gap: 3px;
    }
    .writior-toast__title {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
    }
    .writior-toast__count {
      font-size: 11px;
      color: rgba(226, 232, 240, 0.86);
    }
    .writior-toast__description {
      margin: 0;
      font-size: 12px;
      line-height: 1.4;
      color: rgba(226, 232, 240, 0.88);
    }
    .writior-toast__actions {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .writior-toast__action,
    .writior-toast__dismiss {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
    }
    .writior-toast__action {
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.12);
      font-size: 11px;
      font-weight: 600;
    }
    .writior-toast__dismiss {
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: rgba(226, 232, 240, 0.9);
    }
    .writior-toast__action:focus-visible,
    .writior-toast__dismiss:focus-visible {
      outline: 2px solid #f8fafc;
      outline-offset: 2px;
    }
  `;
  doc.head.appendChild(style);
}

export function createToastRenderer({ doc = document, mountTarget = document.body } = {}) {
  ensureStyle(doc);
  const region = doc.createElement("div");
  region.className = "writior-toast-region";
  region.setAttribute("aria-hidden", "true");
  const politeLive = doc.createElement("div");
  politeLive.className = "writior-toast-live";
  politeLive.setAttribute("aria-live", "polite");
  politeLive.setAttribute("aria-atomic", "true");
  const assertiveLive = doc.createElement("div");
  assertiveLive.className = "writior-toast-live";
  assertiveLive.setAttribute("aria-live", "assertive");
  assertiveLive.setAttribute("aria-atomic", "true");
  mountTarget.append(region, politeLive, assertiveLive);

  function announce(toast) {
    const liveNode = toast.type === TOAST_TYPES.ERROR ? assertiveLive : politeLive;
    liveNode.textContent = [toast.title, toast.description].filter(Boolean).join(". ");
  }

  function createToastNode(toast, { onDismiss, onAction }) {
    const defaults = getToastDefaults(toast.type);
    const node = doc.createElement("article");
    node.className = "writior-toast is-entering";
    node.dataset.toastId = toast.id;
    node.tabIndex = -1;
    node.setAttribute("role", toast.type === TOAST_TYPES.ERROR ? "alert" : "status");
    node.style.setProperty("--toast-accent", defaults.accent);
    node.style.setProperty("--toast-background", defaults.background);
    node.innerHTML = `
      <span class="writior-toast__icon" aria-hidden="true">${iconFor(toast.type)}</span>
      <div class="writior-toast__content">
        <div class="writior-toast__title">
          <span>${toast.title}</span>
          <span class="writior-toast__count"${toast.count > 1 ? "" : ' hidden="hidden"'}>×${toast.count}</span>
        </div>
        ${toast.description ? `<p class="writior-toast__description">${toast.description}</p>` : ""}
        ${toast.actionLabel ? `<div class="writior-toast__actions"><button type="button" class="writior-toast__action">${toast.actionLabel}</button></div>` : ""}
      </div>
      <button type="button" class="writior-toast__dismiss" aria-label="Dismiss notification">×</button>
    `;
    node.querySelector(".writior-toast__dismiss")?.addEventListener("click", () => onDismiss(toast.id));
    node.querySelector(".writior-toast__action")?.addEventListener("click", () => onAction(toast.id));
    requestAnimationFrame(() => {
      node.classList.remove("is-entering");
    });
    return node;
  }

  function render(toasts, { onDismiss, onAction }) {
    const nextIds = new Set(toasts.map((toast) => toast.id));
    const existing = new Map(Array.from(region.children).map((node) => [node.dataset.toastId, node]));
    for (const toast of toasts) {
      let node = existing.get(toast.id);
      if (!node) {
        node = createToastNode(toast, { onDismiss, onAction });
      } else {
        node.querySelector(".writior-toast__title span")?.replaceChildren(doc.createTextNode(toast.title));
        const countNode = node.querySelector(".writior-toast__count");
        if (countNode) {
          countNode.hidden = toast.count <= 1;
          countNode.textContent = `×${toast.count}`;
        }
        const descriptionNode = node.querySelector(".writior-toast__description");
        if (descriptionNode) {
          descriptionNode.textContent = toast.description || "";
        } else if (toast.description) {
          const description = doc.createElement("p");
          description.className = "writior-toast__description";
          description.textContent = toast.description;
          node.querySelector(".writior-toast__content")?.appendChild(description);
        }
      }
      region.appendChild(node);
    }
    for (const [id, node] of existing.entries()) {
      if (nextIds.has(id)) continue;
      node.classList.add("is-exiting");
      window.setTimeout(() => {
        if (node.parentNode === region) {
          node.remove();
        }
      }, FEEDBACK_CONSTANTS.EXIT_MS);
    }
  }

  function bindEscape(getMostRecentVisibleId, dismissById) {
    doc.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const active = doc.activeElement;
      const focusedToast = active?.closest?.(".writior-toast");
      if (focusedToast?.dataset?.toastId) {
        dismissById(focusedToast.dataset.toastId);
        return;
      }
      const latestId = getMostRecentVisibleId();
      if (latestId) {
        dismissById(latestId);
      }
    });
  }

  return { render, announce, bindEscape };
}
