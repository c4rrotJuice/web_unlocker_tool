(() => {
  const DEBUG =
    window.__webUnlockerDebug === true ||
    window.__WEB_UNLOCKER_DEBUG__ === true ||
    window.localStorage?.getItem("webUnlockerDebug") === "1";
  const debug = (...args) => {
    if (DEBUG) {
      console.debug("[Web Unlocker]", ...args);
    }
  };

  if (window.__webUnlockerContentScriptInjected) {
    if (document.documentElement) {
      document.documentElement.dataset.webUnlocker = "1";
    }
    return;
  }
  window.__webUnlockerContentScriptInjected = true;

  const state = {
    selectionText: "",
    lastFormat: "mla",
    lastCitationText: "",
    customFormatName: "",
    customFormatTemplate: "",
  };

  const STYLE_ID = "web-unlocker-extension-style";
  // Guard flag prevents repeated enable toasts on reinjection.
  const ENABLE_TOAST_FLAG = "__WEB_UNLOCKER_ENABLED__";

  let styleInjectQueued = false;
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    if (!document.head) {
      if (!styleInjectQueued) {
        styleInjectQueued = true;
        debug("Styles deferred; document.head not ready yet.");
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            styleInjectQueued = false;
            injectStyles();
          },
          { once: true },
        );
      }
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      * {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
      }

      .web-unlocker-copy-btn {
        position: fixed;
        background: #282c34;
        color: #fff;
        padding: 6px 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 12px;
        font-weight: 600;
        border-radius: 6px;
        z-index: 2147483647;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transition: transform 0.1s ease-out;
        pointer-events: auto;
      }

      .web-unlocker-copy-btn:hover {
        transform: scale(1.04);
      }

      .web-unlocker-backdrop {
        position: fixed;
        inset: 0;
        backdrop-filter: blur(5px);
        background: rgba(0,0,0,0.4);
        z-index: 2147483646;
        pointer-events: auto;
      }

      .web-unlocker-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        z-index: 2147483647;
        width: min(720px, 92vw);
        max-height: 85vh;
        border: 1px solid #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #1f2937;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        pointer-events: auto;
      }

      .web-unlocker-popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 22px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      .web-unlocker-popup-header h3 {
        margin: 0;
        font-size: 18px;
      }

      .web-unlocker-popup-close {
        background: transparent;
        border: none;
        font-size: 20px;
        line-height: 1;
        color: #6b7280;
        cursor: pointer;
        padding: 4px 6px;
      }

      .web-unlocker-popup-close:hover {
        color: #111827;
      }

      .web-unlocker-popup-body {
        padding: 16px 22px;
        overflow-y: auto;
        flex: 1 1 auto;
      }

      .web-unlocker-popup pre {
        background: #f8fafc;
        padding: 10px;
        border-radius: 6px;
        overflow-x: auto;
        font-family: "Courier New", Courier, monospace;
        font-size: 13px;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .web-unlocker-popup-body button,
      .web-unlocker-footer button {
        background-color: #3b82f6;
        color: #fff;
        padding: 8px 12px;
        margin-top: 8px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.2s;
      }

      .web-unlocker-popup-body button.secondary,
      .web-unlocker-footer button.secondary {
        background-color: #e5e7eb;
        color: #111827;
      }

      .web-unlocker-popup-body button:hover,
      .web-unlocker-footer button:hover {
        background-color: #2563eb;
      }

      .web-unlocker-popup-body button.secondary:hover,
      .web-unlocker-footer button.secondary:hover {
        background-color: #d1d5db;
      }

      .web-unlocker-row {
        margin-bottom: 16px;
      }

      .web-unlocker-row strong {
        display: block;
        margin-bottom: 6px;
      }

      .web-unlocker-custom input,
      .web-unlocker-custom textarea {
        width: 100%;
        margin-top: 6px;
        padding: 8px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
      }

      .web-unlocker-custom textarea {
        min-height: 80px;
      }

      .web-unlocker-footer {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        padding: 12px 22px 18px;
        border-top: 1px solid #e5e7eb;
      }

      .web-unlocker-toast {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: #282c34;
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      .web-unlocker-toast.show {
        opacity: 1;
        transform: translate(-50%, -6px);
      }

      .web-unlocker-auth-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
      }

      .web-unlocker-auth-modal {
        background: #ffffff;
        color: #0f172a;
        border-radius: 14px;
        padding: 20px 22px;
        width: min(360px, 90vw);
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
        font-family: inherit;
      }

      .web-unlocker-auth-modal h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }

      .web-unlocker-auth-modal p {
        margin: 0 0 16px;
        font-size: 14px;
        color: #475569;
      }

      .web-unlocker-auth-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
      }

      .web-unlocker-auth-button {
        border: none;
        border-radius: 999px;
        padding: 8px 16px;
        font-size: 14px;
        cursor: pointer;
        background: #2563eb;
        color: #fff;
      }

      .web-unlocker-auth-button.secondary {
        background: #e2e8f0;
        color: #0f172a;
      }
    `;
    document.head.appendChild(style);
  }

  function enableSelection() {
    const events = [
      "contextmenu",
      "copy",
      "cut",
      "selectstart",
      "mousedown",
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, (event) => event.stopPropagation(), {
        capture: true,
      });
      document.addEventListener(eventName, (event) => event.stopPropagation(), {
        capture: true,
      });
    });

    document.oncontextmenu = null;
    document.oncopy = null;
    document.onselectstart = null;
    if (document.body) {
      document.body.oncontextmenu = null;
      document.body.oncopy = null;
      document.body.onselectstart = null;
    }
  }

  function showToast(message, isError = false) {
    const root = document.body || document.documentElement;
    if (!root) {
      debug("Toast skipped; no root element available.");
      return;
    }
    const toast = document.createElement("div");
    toast.className = "web-unlocker-toast";
    toast.textContent = message;
    if (isError) {
      toast.style.backgroundColor = "#ef4444";
    }
    root.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function openLoginPage() {
    sendMessage("OPEN_LOGIN");
  }

  function showSignedOutModal({ autoOpen = false } = {}) {
    const root = document.body || document.documentElement;
    if (!root) {
      return;
    }
    const existing = document.querySelector(".web-unlocker-auth-overlay");
    if (existing) {
      if (autoOpen) {
        openLoginPage();
      }
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "web-unlocker-auth-overlay";

    const modal = document.createElement("div");
    modal.className = "web-unlocker-auth-modal";

    const title = document.createElement("h3");
    title.textContent = "Signed out";
    modal.appendChild(title);

    const body = document.createElement("p");
    body.textContent = "You’ve been away for a while. Please sign in again.";
    modal.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "web-unlocker-auth-actions";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "web-unlocker-auth-button secondary";
    closeButton.textContent = "Dismiss";
    closeButton.addEventListener("click", () => {
      overlay.remove();
    });

    const signInButton = document.createElement("button");
    signInButton.type = "button";
    signInButton.className = "web-unlocker-auth-button";
    signInButton.textContent = "Sign in";
    signInButton.addEventListener("click", () => {
      openLoginPage();
    });

    actions.appendChild(closeButton);
    actions.appendChild(signInButton);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    if (autoOpen) {
      openLoginPage();
    }
  }

  function closePopup() {
    document.querySelector(".web-unlocker-popup")?.remove();
    document.querySelector(".web-unlocker-backdrop")?.remove();
    document.removeEventListener("keydown", handleKeydown);
    unlockPageScroll();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closePopup();
    }
  }

  function sanitizeText(text) {
    return text.replace(/[&<>\"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return map[char] || char;
    });
  }

  function formatCitation(format, selectionText, title, url, accessed) {
    const safeTitle = title ? `*${title}*` : "";
    const year = new Date(accessed).getFullYear();
    switch (format) {
      case "apa":
        return `(${year}). ${title || "Untitled"}. Retrieved from ${url}\n\n"${selectionText}"`;
      case "chicago":
        return `"${selectionText}" ${safeTitle}. Accessed ${accessed}. ${url}.`;
      case "harvard":
        return `${title || "Untitled"}. (${year}). Available at: ${url} (Accessed: ${accessed}).`;
      case "mla":
      default:
        return `"${selectionText}" ${safeTitle}. Accessed ${accessed}, ${url}.`;
    }
  }

  function formatCustomCitation(template, selectionText, title, url, accessed) {
    if (!template) {
      return "";
    }
    return template
      .replace(/\{title\}/gi, title || "")
      .replace(/\{url\}/gi, url)
      .replace(/\{accessed\}/gi, accessed)
      .replace(/\{quote\}/gi, selectionText);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch (err) {
        document.body.removeChild(textarea);
        return false;
      }
    }
  }

  function sendMessage(type, payload) {
    debug("Sending message", { type });
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) {
          resolve({ error: "Extension context invalidated." });
          return;
        }
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          if (chrome.runtime.lastError) {
            debug("Message error", chrome.runtime.lastError.message);
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          debug("Message response", { type, response });
          resolve(response);
        });
      } catch (error) {
        const message = error?.message || "Extension context invalidated.";
        debug("Message error", message);
        resolve({ error: message });
      }
    });
  }

  async function saveCitation(payload) {
    const response = await sendMessage("SAVE_CITATION", payload);
    if (response?.status === 401 || response?.error === "unauthenticated") {
      showToast("Sign in to save citations.", true);
      return;
    }
    if (response?.status === 403) {
      showToast("Upgrade to unlock this citation format.", true);
      return;
    }
    if (response?.error) {
      showToast("Failed to save citation.", true);
      return;
    }
  }

  async function handleCopy(format, citationText, metadata) {
    const copied = await copyText(citationText);
    if (copied) {
      const label = format === "custom" ? "Custom" : format.toUpperCase();
      showToast(`Citation copied (${label}).`);
      // Close quickly after a successful copy for a smoother flow.
      closePopup();
    } else {
      showToast("Copy failed. Please try manually.", true);
    }

    state.lastFormat = format;
    state.lastCitationText = citationText;

    await saveCitation({
      url: metadata.url,
      excerpt: metadata.excerpt,
      full_text: citationText,
      format,
      custom_format_name: metadata.customFormatName || null,
      custom_format_template: metadata.customFormatTemplate || null,
      metadata: {
        source: "extension",
        title: metadata.title,
        selected_text: metadata.selectionText,
        accessed_at: metadata.accessedAt,
      },
    });
  }

  async function handleWorkInEditor(payload) {
    const response = await sendMessage("WORK_IN_EDITOR", payload);
    if (response?.error === "session_expired") {
      showSignedOutModal({ autoOpen: true });
      return;
    }
    if (response?.status === 401 || response?.error === "unauthenticated") {
      showToast("Please sign in to use the editor.", true);
      return;
    }
    if (response?.status === 403 || response?.error === "upgrade_required") {
      showToast("Upgrade required to use the editor.", true);
      return;
    }
    if (response?.status === 429) {
      showToast("Weekly editor limit reached.", true);
      return;
    }
    if (response?.error) {
      showToast("Unable to open the editor.", true);
      return;
    }
    showToast("Opening editor…");
    closePopup();
  }

  function lockPageScroll() {
    const docEl = document.documentElement;
    const body = document.body;
    if (!docEl || !body) {
      return;
    }
    if (docEl.dataset.webUnlockerScrollLocked === "1") {
      return;
    }
    docEl.dataset.webUnlockerScrollLocked = "1";
    docEl.dataset.webUnlockerPrevOverflow = docEl.style.overflow || "";
    body.dataset.webUnlockerPrevOverflow = body.style.overflow || "";
    // Prevent page scroll while the modal is open.
    docEl.style.overflow = "hidden";
    body.style.overflow = "hidden";
  }

  function unlockPageScroll() {
    const docEl = document.documentElement;
    const body = document.body;
    if (!docEl || !body) {
      return;
    }
    if (docEl.dataset.webUnlockerScrollLocked !== "1") {
      return;
    }
    docEl.style.overflow = docEl.dataset.webUnlockerPrevOverflow || "";
    body.style.overflow = body.dataset.webUnlockerPrevOverflow || "";
    delete docEl.dataset.webUnlockerScrollLocked;
    delete docEl.dataset.webUnlockerPrevOverflow;
    delete body.dataset.webUnlockerPrevOverflow;
  }

  function buildPopup() {
    closePopup();
    const selectionText = state.selectionText;
    debug("Building popup", { selectionLength: selectionText.length });
    const url = window.location.href;
    const title = document.title || "Untitled Page";
    const accessed = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const metadata = {
      url,
      title,
      selectionText,
      excerpt: selectionText.slice(0, 140),
      accessedAt: new Date().toISOString(),
    };

    const formats = ["mla", "apa", "chicago", "harvard"];
    const popup = document.createElement("div");
    popup.className = "web-unlocker-popup";
    popup.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "web-unlocker-popup-header";

    const headerTitle = document.createElement("h3");
    headerTitle.textContent = "Cite This Selection";
    header.appendChild(headerTitle);

    const headerClose = document.createElement("button");
    headerClose.className = "web-unlocker-popup-close close-popup";
    headerClose.type = "button";
    headerClose.setAttribute("aria-label", "Close citation popup");
    headerClose.textContent = "×";
    header.appendChild(headerClose);

    popup.appendChild(header);

    const body = document.createElement("div");
    body.className = "web-unlocker-popup-body";
    // Scrollable body keeps the popup within the viewport.

    formats.forEach((format) => {
      const label = format.toUpperCase();
      const text = formatCitation(format, selectionText, title, url, accessed);

      const row = document.createElement("div");
      row.className = "web-unlocker-row";
      row.dataset.format = format;

      const titleEl = document.createElement("strong");
      titleEl.textContent = `${label} Format`;
      row.appendChild(titleEl);

      const pre = document.createElement("pre");
      pre.id = `cite-${format}`;
      pre.textContent = text;
      row.appendChild(pre);

      const button = document.createElement("button");
      button.className = "copy-btn";
      button.dataset.format = format;
      button.textContent = `Copy ${label}`;
      row.appendChild(button);

      body.appendChild(row);
    });

    const customRow = document.createElement("div");
    customRow.className = "web-unlocker-row web-unlocker-custom";

    const customTitle = document.createElement("strong");
    customTitle.textContent = "Custom (Pro)";
    customRow.appendChild(customTitle);

    const customNameInput = document.createElement("input");
    customNameInput.id = "custom-name";
    customNameInput.type = "text";
    customNameInput.placeholder = "Format name";
    customRow.appendChild(customNameInput);

    const customTemplateInput = document.createElement("textarea");
    customTemplateInput.id = "custom-template";
    customTemplateInput.placeholder =
      "Template (use {title}, {url}, {accessed}, {quote})";
    customRow.appendChild(customTemplateInput);

    const customPreviewEl = document.createElement("pre");
    customPreviewEl.id = "cite-custom";
    customRow.appendChild(customPreviewEl);

    const customButton = document.createElement("button");
    customButton.className = "copy-btn";
    customButton.dataset.format = "custom";
    customButton.textContent = "Copy Custom";
    customRow.appendChild(customButton);

    body.appendChild(customRow);

    const footer = document.createElement("div");
    footer.className = "web-unlocker-footer";

    const workButton = document.createElement("button");
    workButton.className = "work-in-editor";
    workButton.type = "button";
    workButton.textContent = "Work in editor";
    footer.appendChild(workButton);

    const closeButton = document.createElement("button");
    closeButton.className = "secondary close-popup";
    closeButton.type = "button";
    closeButton.textContent = "Close";
    footer.appendChild(closeButton);

    popup.appendChild(body);
    popup.appendChild(footer);

    const backdrop = document.createElement("div");
    backdrop.className = "web-unlocker-backdrop";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closePopup();
      }
    });

    popup.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("close-popup")) {
        closePopup();
        return;
      }

      if (target.classList.contains("work-in-editor")) {
        const citationFormat = state.lastFormat || "mla";
        const citationText =
          state.lastCitationText ||
          formatCitation(citationFormat, selectionText, title, url, accessed);
        await handleWorkInEditor({
          url,
          title,
          selected_text: selectionText,
          citation_format: citationFormat,
          citation_text: citationText,
          custom_format_name: state.customFormatName || null,
          custom_format_template: state.customFormatTemplate || null,
        });
        return;
      }

      if (target.classList.contains("copy-btn")) {
        const format = target.dataset.format || "mla";
        if (format === "custom") {
          const template = customTemplateInput.value.trim();
          const name = customNameInput.value.trim();
          const text = formatCustomCitation(template, selectionText, title, url, accessed);
          if (!text) {
            showToast("Add a custom template first.", true);
            return;
          }
          state.customFormatName = name;
          state.customFormatTemplate = template;
          await handleCopy("custom", text, {
            ...metadata,
            customFormatName: name,
            customFormatTemplate: template,
          });
          return;
        }

        const text = formatCitation(format, selectionText, title, url, accessed);
        await handleCopy(format, text, metadata);
      }
    });

    const root = document.body || document.documentElement;
    if (!root) {
      debug("Popup aborted; no root element available.");
      return;
    }
    root.appendChild(backdrop);
    root.appendChild(popup);
    debug("Popup injected.");
    document.addEventListener("keydown", handleKeydown);
    lockPageScroll();
    popup.focus();

    function updateCustomPreview() {
      const template = customTemplateInput.value.trim();
      const text = formatCustomCitation(template, selectionText, title, url, accessed);
      state.customFormatTemplate = template;
      customPreviewEl.textContent = text || "Custom preview";
    }

    customTemplateInput.addEventListener("input", updateCustomPreview);
    customNameInput.addEventListener("input", () => {
      state.customFormatName = customNameInput.value.trim();
    });

    updateCustomPreview();
  }

  let copyButton = null;
  let lastSelectionRect = null;
  let lastSelectionRange = null;
  let ignoreClearUntil = 0;
  let repositionListenersActive = false;

  function createCopyButton() {
    if (copyButton) {
      return copyButton;
    }
    const button = document.createElement("div");
    button.className = "web-unlocker-copy-btn";
    button.textContent = "📋 Copy + Cite";
    button.addEventListener(
      "pointerdown",
      (event) => {
        debug("Button pointerdown.");
        ignoreClearUntil = Date.now() + 400;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        removeCopyButton();
        try {
          buildPopup();
        } catch (error) {
          debug("Popup build failed", error);
        }
      },
      true,
    );

    const root = document.documentElement || document.body;
    if (!root) {
      debug("Copy button skipped; no root element available.");
      return null;
    }
    root.appendChild(button);
    copyButton = button;
    debug("Copy button injected.");
    return copyButton;
  }

  function getSelectionRect(selection, event) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    try {
      const range = selection.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        const rects = range.getClientRects();
        rect = rects && rects.length ? rects[0] : rect;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        const caretRange = range.cloneRange();
        caretRange.collapse(false);
        const caretRects = caretRange.getClientRects();
        rect = caretRects && caretRects.length ? caretRects[0] : rect;
      }
      if (rect) {
        lastSelectionRange = range;
        return rect;
      }
    } catch (error) {
      debug("Selection rect failed", error);
    }
    if (event) {
      return {
        left: event.clientX,
        right: event.clientX,
        top: event.clientY,
        bottom: event.clientY,
        width: 0,
        height: 0,
      };
    }
    return null;
  }

  function positionCopyButton(rect) {
    const button = createCopyButton();
    if (!button || !rect) {
      return;
    }
    const offset = 8;
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    const buttonWidth = button.offsetWidth || 160;
    const buttonHeight = button.offsetHeight || 30;
    const rawLeft = rect.left;
    const rawTop = rect.bottom + offset;
    const maxLeft = Math.max(offset, viewWidth - buttonWidth - offset);
    const maxTop = Math.max(offset, viewHeight - buttonHeight - offset);
    const left = Math.min(Math.max(rawLeft, offset), maxLeft);
    const top = Math.min(Math.max(rawTop, offset), maxTop);
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    const computed = window.getComputedStyle(button);
    debug("Copy button position", {
      left: button.style.left,
      top: button.style.top,
      zIndex: computed.zIndex,
      pointerEvents: computed.pointerEvents,
      rect: button.getBoundingClientRect(),
    });
  }

  function updateCopyButtonPosition() {
    if (!copyButton || !lastSelectionRect) {
      return;
    }
    let rect = lastSelectionRect;
    if (lastSelectionRange) {
      try {
        rect = lastSelectionRange.getBoundingClientRect();
      } catch (error) {
        debug("Selection range rect update failed", error);
      }
    }
    lastSelectionRect = rect;
    positionCopyButton(rect);
  }

  function removeCopyButton() {
    if (copyButton) {
      copyButton.remove();
      copyButton = null;
    }
    lastSelectionRect = null;
    lastSelectionRange = null;
  }

  function ensureRepositionListeners() {
    if (repositionListenersActive) {
      return;
    }
    repositionListenersActive = true;
    const handler = () => updateCopyButtonPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler, true);
  }

  function showCopyButton(rect) {
    lastSelectionRect = rect;
    positionCopyButton(rect);
    ensureRepositionListeners();
  }

  function handleMouseUp(event) {
    if (Date.now() < ignoreClearUntil) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".web-unlocker-popup")) {
      return;
    }
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    debug("Mouseup selection", { length: text.length });
    if (!text) {
      removeCopyButton();
      return;
    }

    state.selectionText = text;
    state.lastCitationText = "";

    const rect = getSelectionRect(selection, event);
    if (!rect) {
      debug("Selection rect missing; skipping button.");
      return;
    }
    debug("Selection rect", rect);
    showCopyButton(rect);
  }

  function handleMouseDown(event) {
    if (Date.now() < ignoreClearUntil) {
      return;
    }
    const target = event.target;
    const inPopup = target instanceof Element && target.closest(".web-unlocker-popup");
    const isButton =
      target instanceof Element && target.classList.contains("web-unlocker-copy-btn");
    if (!inPopup && !isButton) {
      removeCopyButton();
    }
  }

  debug("Content script init", {
    url: window.location.href,
    top: window.top === window,
    readyState: document.readyState,
    hasBody: Boolean(document.body),
    hasHead: Boolean(document.head),
  });

  injectStyles();
  enableSelection();

  if (document.documentElement) {
    // Marker lets page-context DevTools confirm the script is active.
    document.documentElement.dataset.webUnlocker = "1";
  }

  if (!window[ENABLE_TOAST_FLAG]) {
    window[ENABLE_TOAST_FLAG] = true;
    if (document.body) {
      showToast("Web Unlocker enabled ✓");
    } else {
      debug("Enable toast skipped; body not available yet.");
    }
  }

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousedown", handleMouseDown);

  if (DEBUG) {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const elements = document.elementsFromPoint(event.clientX, event.clientY);
        debug("Pointerdown elementsFromPoint", elements);
      },
      true,
    );
  }
})();
