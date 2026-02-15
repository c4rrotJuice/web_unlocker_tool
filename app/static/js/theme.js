(function () {
  const STORAGE_KEY = "web_unlocker_theme";
  const VALID_THEMES = new Set(["light", "dark", "system"]);
  const MEDIA_QUERY = "(prefers-color-scheme: dark)";

  let initialized = false;
  let mediaQueryList = null;
  let mediaQueryListenerAttached = false;
  let authSubscription = null;

  function isValidTheme(mode) {
    return VALID_THEMES.has(mode);
  }

  function getStoredTheme() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return isValidTheme(stored) ? stored : "system";
    } catch (_error) {
      return "system";
    }
  }

  function getEffectiveTheme(mode) {
    if (mode === "dark") {
      return "dark";
    }

    if (mode === "light") {
      return "light";
    }

    return window.matchMedia && window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
  }

  function applyTheme(mode) {
    const selectedMode = isValidTheme(mode) ? mode : "system";
    const effectiveTheme = getEffectiveTheme(selectedMode);
    const root = document.documentElement;

    root.classList.toggle("dark", effectiveTheme === "dark");
    root.dataset.themeMode = selectedMode;
    root.style.colorScheme = effectiveTheme;

    const themeToggle = document.getElementById("themeToggle");
    if (themeToggle) {
      themeToggle.dataset.themeMode = selectedMode;
      themeToggle.setAttribute("aria-label", `Theme: ${selectedMode}. Click to switch theme.`);
      themeToggle.textContent = `Theme: ${selectedMode[0].toUpperCase()}${selectedMode.slice(1)}`;
    }

    return effectiveTheme;
  }

  async function getSession() {
    try {
      return await window.webUnlockerAuth?.getSession?.();
    } catch (_error) {
      return { data: { session: null }, error: null };
    }
  }

  async function upsertThemeForSession(mode, session) {
    if (!session?.user?.id) {
      return;
    }

    const client = window.webUnlockerAuth?.client || (await window.webUnlockerAuth?.ready?.());
    if (!client) {
      return;
    }

    await client
      .from("user_preferences")
      .upsert(
        {
          user_id: session.user.id,
          theme: mode,
        },
        {
          onConflict: "user_id",
        },
      );
  }

  async function setTheme(mode, options = {}) {
    const selectedMode = isValidTheme(mode) ? mode : "system";

    try {
      window.localStorage.setItem(STORAGE_KEY, selectedMode);
    } catch (_error) {
      // no-op
    }

    applyTheme(selectedMode);

    if (options.persistRemote === false) {
      return selectedMode;
    }

    const { data } = await getSession();
    if (!data?.session) {
      return selectedMode;
    }

    try {
      await upsertThemeForSession(selectedMode, data.session);
    } catch (error) {
      console.error("Theme preference save failed:", error);
    }

    return selectedMode;
  }

  async function syncThemeFromDatabase() {
    const { data } = await getSession();
    const session = data?.session;

    if (!session?.user?.id) {
      return;
    }

    const client = window.webUnlockerAuth?.client || (await window.webUnlockerAuth?.ready?.());
    if (!client) {
      return;
    }

    const localTheme = getStoredTheme();

    try {
      const { data: row, error } = await client
        .from("user_preferences")
        .select("theme")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (row?.theme && isValidTheme(row.theme)) {
        try {
          window.localStorage.setItem(STORAGE_KEY, row.theme);
        } catch (_error) {
          // no-op
        }
        applyTheme(row.theme);
        return;
      }

      await upsertThemeForSession(localTheme, session);
    } catch (error) {
      console.error("Theme preference sync failed:", error);
    }
  }

  function attachSystemThemeListener() {
    if (!window.matchMedia) {
      return;
    }

    if (!mediaQueryList) {
      mediaQueryList = window.matchMedia(MEDIA_QUERY);
    }

    if (mediaQueryListenerAttached) {
      return;
    }

    const listener = () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    };

    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", listener);
    } else if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(listener);
    }

    mediaQueryListenerAttached = true;
  }

  function attachStorageListener() {
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }

      const mode = isValidTheme(event.newValue) ? event.newValue : "system";
      applyTheme(mode);
    });
  }

  function cycleTheme() {
    const currentMode = getStoredTheme();
    const nextMode = currentMode === "system" ? "light" : currentMode === "light" ? "dark" : "system";
    setTheme(nextMode);
  }

  function bindThemeToggle() {
    const themeToggle = document.getElementById("themeToggle");
    if (!themeToggle || themeToggle.dataset.bound === "true") {
      return;
    }

    themeToggle.dataset.bound = "true";
    themeToggle.addEventListener("click", () => {
      cycleTheme();
    });

    applyTheme(getStoredTheme());
  }

  async function initTheme() {
    applyTheme(getStoredTheme());

    bindThemeToggle();
    attachSystemThemeListener();

    if (!initialized) {
      initialized = true;
      attachStorageListener();
      await syncThemeFromDatabase();

      if (window.webUnlockerAuth?.onAuthStateChange) {
        const { data: subscriptionData } = await window.webUnlockerAuth.onAuthStateChange(async (event) => {
          if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
            await syncThemeFromDatabase();
          }
        });
        authSubscription = subscriptionData?.subscription || null;
      }
    }

    return { unsubscribe: () => authSubscription?.unsubscribe?.() };
  }

  window.webUnlockerTheme = {
    STORAGE_KEY,
    getStoredTheme,
    getEffectiveTheme,
    applyTheme,
    setTheme,
    initTheme,
    bindThemeToggle,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initTheme();
    });
  } else {
    initTheme();
  }
})();
