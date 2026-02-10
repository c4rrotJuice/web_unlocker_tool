document.addEventListener("DOMContentLoaded", async () => {
  const authButton = document.getElementById("authButton");
  if (!authButton) return;

  const dashboardLink = document.getElementById("dashboardLink");
  const editorLink = document.getElementById("editorLink");

  let authenticated = false;
  try {
    const res = await window.apiFetch("/api/auth/me", { skipAuthRedirect: true });
    authenticated = res.ok;
  } catch (err) {
    authenticated = false;
  }

  if (authenticated) {
    authButton.textContent = "Sign out";
    authButton.href = "#";
    authButton.addEventListener("click", async (event) => {
      event.preventDefault();
      await window.apiFetch("/api/auth/logout", { method: "POST", skipAuthRedirect: true });
      window.location.href = "/";
    });

    if (dashboardLink) dashboardLink.style.display = "inline";
    if (editorLink) editorLink.style.display = "inline";
  } else {
    authButton.textContent = "Sign in/Up";
    authButton.href = "/static/auth.html";

    if (dashboardLink) dashboardLink.style.display = "none";
    if (editorLink) editorLink.style.display = "none";
  }
});
