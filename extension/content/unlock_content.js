(() => {
  const DEBUG = false;
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

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
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
        position: absolute;
        background: #282c34;
        color: #fff;
        padding: 6px 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 12px;
        font-weight: 600;
        border-radius: 6px;
        z-index: 2147483646;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transition: transform 0.1s ease-out;
      }

      .web-unlocker-copy-btn:hover {
        transform: scale(1.04);
      }

      .web-unlocker-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        backdrop-filter: blur(5px);
        background: rgba(0,0,0,0.4);
        z-index: 2147483644;
      }

      .web-unlocker-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        padding: 22px;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        z-index: 2147483645;
        width: 92%;
        max-width: 560px;
        border: 1px solid #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #1f2937;
      }

      .web-unlocker-popup h3 {
        margin: 0 0 12px;
        font-size: 18px;
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

      .web-unlocker-popup button {
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

      .web-unlocker-popup button.secondary {
        background-color: #e5e7eb;
        color: #111827;
      }

      .web-unlocker-popup button:hover {
        background-color: #2563eb;
      }

      .web-unlocker-popup button.secondary:hover {
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
        margin-top: 10px;
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

  function removeCopyButton() {
    const existing = document.querySelector(".web-unlocker-copy-btn");
    if (existing) {
      existing.remove();
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

  function closePopup() {
    document.querySelector(".web-unlocker-popup")?.remove();
    document.querySelector(".web-unlocker-backdrop")?.remove();
    document.removeEventListener("keydown", handleKeydown);
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
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
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
      showToast("Citation copied!");
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

  function buildPopup() {
    closePopup();
    const selectionText = state.selectionText;
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

    const header = document.createElement("h3");
    header.textContent = "Cite This Selection";
    popup.appendChild(header);

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

      popup.appendChild(row);
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

    popup.appendChild(customRow);

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

    popup.appendChild(footer);

    const backdrop = document.createElement("div");
    backdrop.className = "web-unlocker-backdrop";
    backdrop.addEventListener("click", closePopup);

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
    root.appendChild(backdrop);
    root.appendChild(popup);
    document.addEventListener("keydown", handleKeydown);

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

  function showCopyButton(rect) {
    removeCopyButton();
    const button = document.createElement("div");
    button.className = "web-unlocker-copy-btn";
    button.textContent = "📋 Copy + Cite";

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const left = rect.left + scrollX;
    const top = rect.bottom + scrollY + 10;

    button.style.left = `${Math.max(left, 8)}px`;
    button.style.top = `${Math.max(top, 8)}px`;
    button.addEventListener("click", () => {
      removeCopyButton();
      buildPopup();
    });

    document.body.appendChild(button);
  }

  function handleMouseUp(event) {
    const target = event.target;
    if (target instanceof Element && target.closest(".web-unlocker-popup")) {
      return;
    }
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    if (!text) {
      removeCopyButton();
      return;
    }

    state.selectionText = text;
    state.lastCitationText = "";

    let rect = null;
    try {
      if (selection && selection.rangeCount > 0) {
        rect = selection.getRangeAt(0).getBoundingClientRect();
      }
    } catch (error) {
      rect = null;
    }
    if (!rect) {
      const fallbackRect = {
        left: event.pageX,
        bottom: event.pageY,
      };
      showCopyButton(fallbackRect);
      return;
    }
    showCopyButton(rect);
  }

  function handleMouseDown(event) {
    const target = event.target;
    const inPopup = target instanceof Element && target.closest(".web-unlocker-popup");
    const isButton =
      target instanceof Element && target.classList.contains("web-unlocker-copy-btn");
    if (!inPopup && !isButton) {
      removeCopyButton();
    }
  }

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
})();
