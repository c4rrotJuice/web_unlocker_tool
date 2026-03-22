export function createContentToastController({ documentRef = globalThis.document, windowRef = globalThis.window, enabled = false } = {}) {
  let host = null;
  let timer = null;

  function ensureHost() {
    if (!enabled || !documentRef?.body) {
      return null;
    }
    if (host) {
      return host;
    }
    host = documentRef.createElement("div");
    host.setAttribute("data-writior-toast-host", "true");
    host.style.position = "fixed";
    host.style.right = "12px";
    host.style.bottom = "12px";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.style.fontFamily = "system-ui, sans-serif";
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

  function show(message, { duration = 1800 } = {}) {
    const target = ensureHost();
    if (!target) {
      return { visible: false };
    }
    target.innerHTML = "";
    const bubble = documentRef.createElement("div");
    bubble.textContent = message;
    bubble.style.background = "rgba(17, 24, 39, 0.94)";
    bubble.style.color = "#f9fafb";
    bubble.style.padding = "8px 10px";
    bubble.style.borderRadius = "999px";
    bubble.style.fontSize = "12px";
    bubble.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.2)";
    target.appendChild(bubble);
    if (timer) {
      windowRef?.clearTimeout?.(timer);
    }
    timer = windowRef?.setTimeout?.(() => hide(), duration) || null;
    return { visible: true };
  }

  return {
    show,
    hide,
    destroy() {
      hide();
      if (host?.remove) {
        host.remove();
      }
      host = null;
    },
  };
}
