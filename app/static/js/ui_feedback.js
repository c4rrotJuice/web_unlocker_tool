(function () {
  const COPY = {
    errors: {
      INVALID_URL: "Please enter a valid URL.",
      HUMAN_VERIFICATION_REQUIRED: "This page requires human verification before we can unlock it.",
      DAILY_LIMIT_REACHED: "You've reached your daily unlock limit.",
      WEEKLY_LIMIT_REACHED: "You've reached your weekly unlock limit.",
      FETCH_TIMEOUT: "The request took too long. Please try again.",
      UPSTREAM_BLOCKED: "The source blocked this request.",
      AUTH_REQUIRED: "Please sign in to continue.",
      TOKEN_EXPIRED: "Your session expired. Please sign in again.",
      RATE_LIMITED: "Too many requests. Please wait and retry.",
      SERVER_ERROR: "Something went wrong on our side.",
      DEFAULT: "We couldn't complete that request.",
    },
    success: {
      UNLOCK_SUCCESS: "Page unlocked successfully.",
      DOCUMENT_SAVED: "Document saved.",
      LOGIN_SUCCESS: "Signed in successfully.",
      LOGOUT_SUCCESS: "Signed out successfully.",
      PAYMENT_SUCCESS: "Payment completed.",
      BOOKMARK_ADDED: "Bookmark added.",
    },
    info: {
      UNLOCK_STARTED: "Starting unlock…",
      PROCESSING_REQUEST: "Processing request…",
      VERIFYING_AUTH: "Verifying session…",
      FETCHING_CONTENT: "Fetching content…",
      CLEANING_CONTENT: "Cleaning content…",
      SAVING_DOCUMENT: "Saving document…",
      RETRYING_FETCH: "Retrying fetch…",
      COMPLETE: "Completed.",
    },
  };

  function mapApiError(payload) {
    const nested = payload?.error || {};
    const code = nested.code || payload?.error_code || "SERVER_ERROR";
    const requestId = nested.request_id || payload?.request_id || null;
    const message = COPY.errors[code] || nested.message || payload?.message || COPY.errors.DEFAULT;
    const mapped = {
      code,
      message,
      requestId,
      type: code === "RATE_LIMITED" ? "warning" : "error",
      redirectTo: null,
      cta: null,
    };

    if (code === "AUTH_REQUIRED" || code === "TOKEN_EXPIRED") {
      mapped.redirectTo = "/auth?reason=session";
      mapped.cta = { label: "Sign in", href: "/auth" };
    }

    return mapped;
  }

  function createToastManager() {
    let root = document.getElementById("wu-toast-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "wu-toast-root";
      root.setAttribute("aria-live", "polite");
      root.setAttribute("aria-atomic", "true");
      root.style.cssText = "position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:320px;";
      document.body.appendChild(root);
    }

    const active = new Map();

    function dismiss(id) {
      const item = active.get(id);
      if (!item) return;
      item.el.remove();
      active.delete(id);
    }

    function show({ id, type = "info", message, duration = 4000, cta, loading = false }) {
      const key = id || `${type}:${message}`;
      if (active.has(key)) {
        const existing = active.get(key);
        existing.messageEl.textContent = message;
        return key;
      }

      const el = document.createElement("div");
      el.className = "wu-toast";
      el.setAttribute("role", type === "error" ? "alert" : "status");
      el.tabIndex = 0;
      el.style.cssText = "background:#111827;color:#fff;border:1px solid #374151;border-left:4px solid #60a5fa;border-radius:8px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:14px;";
      if (type === "error") el.style.borderLeftColor = "#ef4444";
      if (type === "success") el.style.borderLeftColor = "#22c55e";
      if (type === "warning") el.style.borderLeftColor = "#f59e0b";

      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
      const messageEl = document.createElement("div");
      messageEl.style.flex = "1";
      messageEl.textContent = loading ? `⏳ ${message}` : message;
      row.appendChild(messageEl);

      if (cta?.label && cta?.href) {
        const ctaBtn = document.createElement("a");
        ctaBtn.href = cta.href;
        ctaBtn.textContent = cta.label;
        ctaBtn.style.cssText = "color:#93c5fd;font-weight:600;";
        row.appendChild(ctaBtn);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Dismiss notification");
      closeBtn.textContent = "✕";
      closeBtn.style.cssText = "background:transparent;color:#fff;border:none;cursor:pointer;";
      closeBtn.addEventListener("click", () => dismiss(key));
      row.appendChild(closeBtn);

      el.appendChild(row);
      root.appendChild(el);

      const state = { el, messageEl };
      active.set(key, state);

      if (!loading && duration > 0) {
        state.timeout = setTimeout(() => dismiss(key), duration);
      }
      return key;
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const keys = [...active.keys()];
        if (keys.length) dismiss(keys[keys.length - 1]);
      }
    });

    return { show, dismiss, clearAll: () => [...active.keys()].forEach(dismiss) };
  }

  function createUnlockStatusManager(toastManager) {
    let activeToastId = null;
    const stages = ["UNLOCK_STARTED", "FETCHING_CONTENT", "CLEANING_CONTENT", "COMPLETE"];

    function setStage(stage) {
      if (!stages.includes(stage)) return;
      if (stage === "COMPLETE") {
        if (activeToastId) {
          toastManager.dismiss(activeToastId);
          activeToastId = null;
        }
        toastManager.show({ type: "success", message: COPY.success.UNLOCK_SUCCESS, duration: 2200 });
        return;
      }

      activeToastId = toastManager.show({
        id: "unlock-progress",
        type: "info",
        loading: true,
        message: COPY.info[stage] || COPY.info.PROCESSING_REQUEST,
        duration: 0,
      });
    }

    function fail(message) {
      if (activeToastId) {
        toastManager.dismiss(activeToastId);
        activeToastId = null;
      }
      toastManager.show({ type: "error", message });
    }

    function clear() {
      if (activeToastId) {
        toastManager.dismiss(activeToastId);
        activeToastId = null;
      }
    }

    window.addEventListener("beforeunload", clear);
    return { setStage, fail, clear };
  }

  window.webUnlockerUI = {
    COPY,
    mapApiError,
    createToastManager,
    createUnlockStatusManager,
  };
})();
