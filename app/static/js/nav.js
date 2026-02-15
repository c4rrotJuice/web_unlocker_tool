document.addEventListener("DOMContentLoaded", async () => {
  const navLinks = document.querySelector(".nav-links");
  const existingToggle = document.getElementById("themeToggle");

  if (navLinks && !existingToggle) {
    const themeItem = document.createElement("li");
    themeItem.className = "theme-toggle-item";
    themeItem.innerHTML = '<button type="button" id="themeToggle" class="theme-toggle-btn" aria-live="polite"></button>';
    navLinks.appendChild(themeItem);
  }

  window.webUnlockerTheme?.bindThemeToggle?.();

  const authButton = document.getElementById("authButton");
  const dashboardLink = document.getElementById("dashboardLink");
  const editorLink = document.getElementById("editorLink");
  const token = await window.webUnlockerAuth?.getAccessToken?.();
  const toast = window.webUnlockerUI?.createToastManager?.();

  if (!authButton) {
    return;
  }

  if (token) {
    authButton.textContent = "Sign out";
    authButton.href = "#";
    authButton.addEventListener("click", async (event) => {
      event.preventDefault();
      window.webUnlockerAuth?.writeLegacyToken?.(null);
      if (window.webUnlockerAuth?.client) {
        await window.webUnlockerAuth.client.auth.signOut().catch(() => {});
      }
      toast?.show({ type: "success", message: window.webUnlockerUI?.COPY?.success?.LOGOUT_SUCCESS || "Signed out." });
      window.location.href = "/";
    });

    if (dashboardLink) dashboardLink.style.display = "inline";
    if (editorLink) editorLink.style.display = "inline";
  } else {
    authButton.textContent = "Sign in/Up";
    authButton.href = "/auth";

    if (dashboardLink) dashboardLink.style.display = "none";
    if (editorLink) editorLink.style.display = "none";
  }
});
