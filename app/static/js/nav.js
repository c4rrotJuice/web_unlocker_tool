document.addEventListener("DOMContentLoaded", async () => {
  const authButton = document.getElementById("authButton");
  if (!authButton) {
    return;
  }

  const dashboardLink = document.getElementById("dashboardLink");
  const editorLink = document.getElementById("editorLink");
  const token = await window.webUnlockerAuth?.getAccessToken?.();

  if (token) {
    authButton.textContent = "Sign out";
    authButton.href = "#";
    authButton.addEventListener("click", (event) => {
      event.preventDefault();
      window.webUnlockerAuth?.writeLegacyToken?.(null);
      if (window.webUnlockerAuth?.client) {
        window.webUnlockerAuth.client.auth.signOut().catch(() => {});
      }
      window.location.href = "/";
    });

    if (dashboardLink) {
      dashboardLink.style.display = "inline";
    }
    if (editorLink) {
      editorLink.style.display = "inline";
    }
  } else {
    authButton.textContent = "Sign in/Up";
    authButton.href = "/static/auth.html";

    if (dashboardLink) {
      dashboardLink.style.display = "none";
    }
    if (editorLink) {
      editorLink.style.display = "none";
    }
  }
});
