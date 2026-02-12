export function createToastStatusManager({ toastEl, statusEl }) {
  let toastTimer = null;
  let lastToastKey = null;

  function setStatus(message, type = "info") {
    statusEl.textContent = message;
    statusEl.style.color = type === "error" ? "#b42318" : "#596173";
  }

  function showToast({ message, type = "info", duration = 3200 }) {
    const key = `${type}:${message}`;
    if (key === lastToastKey) return;
    lastToastKey = key;

    toastEl.textContent = message;
    toastEl.classList.remove("hidden", "error", "success", "warning", "info", "loading");
    toastEl.classList.add(type);
    toastEl.setAttribute("role", type === "error" ? "alert" : "status");

    if (toastTimer) clearTimeout(toastTimer);
    if (duration > 0) {
      toastTimer = setTimeout(() => {
        toastEl.classList.add("hidden");
        lastToastKey = null;
      }, duration);
    }
  }

  function dismissToast() {
    toastEl.classList.add("hidden");
    lastToastKey = null;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dismissToast();
    }
  });

  return { setStatus, showToast, dismissToast };
}
