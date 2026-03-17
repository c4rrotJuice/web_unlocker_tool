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
    },
    info: {
      UNLOCK_STARTED: "Starting unlock…",
      PROCESSING_REQUEST: "Processing request…",
      FETCHING_CONTENT: "Fetching content…",
      CLEANING_CONTENT: "Cleaning content…",
    },
  };

  let runtimePromise = null;

  function loadRuntime() {
    if (!runtimePromise) {
      runtimePromise = import("/static/js/shared/feedback/feedback_bus_singleton.js")
        .then(({ ensureFeedbackRuntime }) => ensureFeedbackRuntime({ mountTarget: document.body }));
    }
    return runtimePromise;
  }

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
    const legacyIds = new Map();
    return {
      async show({ id, type = "info", message, duration = 4000, cta }) {
        const runtime = await loadRuntime();
        const previousId = id ? legacyIds.get(id) : null;
        if (previousId) {
          runtime.toast.dismiss(previousId);
        }
        const runtimeId = runtime.toast[type]?.(message, {
          duration,
          actionLabel: cta?.label || "",
          onAction: cta?.href ? () => { window.location.href = cta.href; } : null,
          dedupeKey: id || `${type}:${message}`,
        });
        if (id && runtimeId) {
          legacyIds.set(id, runtimeId);
        }
        return runtimeId;
      },
      async dismiss(id) {
        const runtime = await loadRuntime();
        runtime.toast.dismiss(legacyIds.get(id) || id);
        legacyIds.delete(id);
      },
      async clearAll() {
        const runtime = await loadRuntime();
        runtime.toast.clear();
        legacyIds.clear();
      },
    };
  }

  function createUnlockStatusManager(toastManager) {
    let activeToastId = null;
    const stages = ["UNLOCK_STARTED", "FETCHING_CONTENT", "CLEANING_CONTENT", "COMPLETE"];

    function setStage(stage) {
      if (!stages.includes(stage)) return;
      if (stage === "COMPLETE") {
        if (activeToastId) {
          void toastManager.dismiss(activeToastId);
          activeToastId = null;
        }
        void toastManager.show({ type: "success", message: COPY.success.UNLOCK_SUCCESS, duration: 2200 });
        return;
      }

      void toastManager.show({
        type: "info",
        message: COPY.info[stage] || COPY.info.PROCESSING_REQUEST,
        duration: 0,
      }).then((id) => {
        activeToastId = id;
      });
    }

    function fail(message) {
      if (activeToastId) {
        void toastManager.dismiss(activeToastId);
        activeToastId = null;
      }
      void toastManager.show({ type: "error", message });
    }

    function clear() {
      if (activeToastId) {
        void toastManager.dismiss(activeToastId);
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
