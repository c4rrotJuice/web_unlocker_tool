const COLLAPSED_STORAGE_KEY = "writior_sidebar_collapsed";
const AUTO_HIDE_STORAGE_KEY = "writior_sidebar_auto_hide";
const MOBILE_MEDIA_QUERY = "(max-width: 1024px)";

function readStoredBoolean(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "true") {
      return { exists: true, value: true };
    }
    if (raw === "false") {
      return { exists: true, value: false };
    }
  } catch (_error) {
    return { exists: false, value: false };
  }
  return { exists: false, value: false };
}

function writeStoredBoolean(key, value) {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch (_error) {
    // no-op
  }
}

function nextFocusable(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => !node.hasAttribute("hidden"));
}

export async function initSidebarShell({ page }) {
  if (window.document?.documentElement?.dataset?.sidebarInitialized === "true") {
    return { unsubscribe() {} };
  }
  const shell = document.getElementById("app-shell");
  const sidebar = document.getElementById("app-sidebar");
  const sidebarToggle = document.getElementById("app-sidebar-toggle");
  const sidebarAutoHideToggle = document.getElementById("app-sidebar-autohide-toggle");
  const mobileToggle = document.getElementById("app-sidebar-mobile-toggle");
  const backdrop = document.getElementById("app-sidebar-backdrop");
  if (!shell || !sidebar || !sidebarToggle || !mobileToggle || !backdrop || !sidebarAutoHideToggle) {
    return;
  }

  if (shell.dataset.sidebarInitialized === "true") {
    return { unsubscribe() {} };
  }
  shell.dataset.sidebarInitialized = "true";

  const storedCollapsed = readStoredBoolean(COLLAPSED_STORAGE_KEY);
  const storedAutoHide = readStoredBoolean(AUTO_HIDE_STORAGE_KEY);
  const preferCollapsedForEditor = page === "editor";
  const defaultCollapsed = preferCollapsedForEditor;
  const state = {
    collapsed: storedCollapsed.exists ? storedCollapsed.value : defaultCollapsed,
    autoHide: storedAutoHide.exists ? storedAutoHide.value : false,
    mobileOpen: false,
    mobileMatch: window.matchMedia(MOBILE_MEDIA_QUERY),
  };

  let syncInFlight = null;
  let initInFlight = null;
  const runtimeDebugEnabled = !!window.__WRITIOR_RUNTIME_DEBUG__;
  const runtimeDebugCounts = {
    initCalls: 0,
    syncCalls: 0,
    authEvents: 0,
    subscriptionRegistered: 0,
  };

  function debugSidebar(event, details = {}) {
    if (!runtimeDebugEnabled || typeof console === "undefined" || typeof console.debug !== "function") {
      return;
    }
    console.debug("[writior:sidebar]", event, details);
  }
  let mobileKeydownBound = false;

  const setBodyScrollLock = () => {
    document.body.classList.toggle("has-open-sidebar-drawer", state.mobileOpen && state.mobileMatch.matches);
  };

  const setMobileOpen = (open, options = {}) => {
    state.mobileOpen = !!open && state.mobileMatch.matches;
    shell.dataset.sidebarMobileOpen = state.mobileOpen ? "true" : "false";
    mobileToggle.setAttribute("aria-expanded", state.mobileOpen ? "true" : "false");
    backdrop.hidden = !state.mobileOpen;
    setBodyScrollLock();
    if (state.mobileOpen && options.focusDrawer) {
      const focusables = nextFocusable(sidebar);
      focusables[0]?.focus();
    } else if (!state.mobileOpen && options.returnFocusToToggle) {
      mobileToggle.focus();
    }
  };

  const applyDesktopState = () => {
    shell.dataset.sidebarCollapsed = state.collapsed ? "true" : "false";
    shell.dataset.sidebarAutoHide = state.autoHide ? "true" : "false";
    const expandedLabel = state.autoHide ? "Sidebar set to auto-hide. Toggle to keep it visible." : "Collapse sidebar";
    const collapsedLabel = state.autoHide ? "Sidebar set to auto-hide. Toggle to keep it visible." : "Expand sidebar";
    sidebarToggle.textContent = state.collapsed ? ">" : "<";
    sidebarToggle.setAttribute("aria-label", state.collapsed ? collapsedLabel : expandedLabel);
    sidebarToggle.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
    sidebarAutoHideToggle.setAttribute("aria-pressed", state.autoHide ? "true" : "false");
    sidebarAutoHideToggle.textContent = state.autoHide ? "Auto-hide: On" : "Auto-hide: Off";
  };

  const applyState = () => {
    applyDesktopState();
    if (!state.mobileMatch.matches) {
      setMobileOpen(false);
    }
  };

  const updatePreferenceRemote = async (patch) => {
    try {
      await window.webUnlockerAuth?.authJson?.("/api/preferences", {
        method: "PATCH",
        headers: {
          Accept: "application/json",
        },
        body: patch,
      });
    } catch (_error) {
      // ignore preference network failures
    }
  };

  const persistState = async () => {
    writeStoredBoolean(COLLAPSED_STORAGE_KEY, state.collapsed);
    writeStoredBoolean(AUTO_HIDE_STORAGE_KEY, state.autoHide);
    await updatePreferenceRemote({
      sidebar_collapsed: state.collapsed,
      sidebar_auto_hide: state.autoHide,
    });
  };

  const syncFromRemotePreferences = async () => {
    if (syncInFlight) {
      return syncInFlight;
    }
    runtimeDebugCounts.syncCalls += 1;
    debugSidebar("sync_enter", { count: runtimeDebugCounts.syncCalls });
    syncInFlight = (async () => {
      try {
        const preferences = await window.webUnlockerAuth?.authJson?.("/api/preferences", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!preferences) return;

        const allowRemoteCollapsedPreference = !preferCollapsedForEditor || storedCollapsed.exists;
        if (allowRemoteCollapsedPreference && typeof preferences.sidebar_collapsed === "boolean") {
          state.collapsed = preferences.sidebar_collapsed;
          writeStoredBoolean(COLLAPSED_STORAGE_KEY, state.collapsed);
        }
        if (typeof preferences.sidebar_auto_hide === "boolean") {
          state.autoHide = preferences.sidebar_auto_hide;
          writeStoredBoolean(AUTO_HIDE_STORAGE_KEY, state.autoHide);
        }
        applyState();
      } catch (error) {
        // ignore startup sync failures
      } finally {
        debugSidebar("sync_exit", { count: runtimeDebugCounts.syncCalls });
        syncInFlight = null;
      }
    })();
    return syncInFlight;
  };

  sidebarToggle.addEventListener("click", async () => {
    state.collapsed = !state.collapsed;
    applyState();
    await persistState();
  });

  sidebarAutoHideToggle.addEventListener("click", async () => {
    state.autoHide = !state.autoHide;
    applyState();
    await persistState();
  });

  mobileToggle.addEventListener("click", () => {
    setMobileOpen(!state.mobileOpen, { focusDrawer: true });
  });

  backdrop.addEventListener("click", () => {
    setMobileOpen(false, { returnFocusToToggle: true });
  });

  sidebar.querySelectorAll(".app-nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      if (state.mobileMatch.matches) {
        setMobileOpen(false);
      }
    });
  });

  const handleMobileKeydown = (event) => {
    if (!state.mobileOpen || !state.mobileMatch.matches) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMobileOpen(false, { returnFocusToToggle: true });
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = nextFocusable(sidebar);
    if (!focusables.length) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!mobileKeydownBound) {
    document.addEventListener("keydown", handleMobileKeydown);
    mobileKeydownBound = true;
  }

  const mediaListener = () => {
    applyState();
    setBodyScrollLock();
  };
  if (typeof state.mobileMatch.addEventListener === "function") {
    state.mobileMatch.addEventListener("change", mediaListener);
  } else if (typeof state.mobileMatch.addListener === "function") {
    state.mobileMatch.addListener(mediaListener);
  }

  initInFlight = (async () => {
    runtimeDebugCounts.initCalls += 1;
    debugSidebar("init_enter", { count: runtimeDebugCounts.initCalls });
    if (window.webUnlockerAuth?.onAuthStateChange) {
      try {
        const { data } = await window.webUnlockerAuth.onAuthStateChange((eventName) => {
          runtimeDebugCounts.authEvents += 1;
          debugSidebar("auth_event", { count: runtimeDebugCounts.authEvents, eventName });
          if (eventName === "SIGNED_IN") {
            syncFromRemotePreferences();
          }
        });
        runtimeDebugCounts.subscriptionRegistered += 1;
        debugSidebar("subscription_registered", { count: runtimeDebugCounts.subscriptionRegistered });
        window.addEventListener("beforeunload", () => {
          data?.subscription?.unsubscribe?.();
        }, { once: true });
      } catch (_error) {
        // ignore auth state hookup errors
      }
    }

    applyState();
    await syncFromRemotePreferences();
    debugSidebar("init_exit", { count: runtimeDebugCounts.initCalls });
    return { unsubscribe() {} };
  })().finally(() => {
    initInFlight = null;
  });

  return initInFlight;
}
