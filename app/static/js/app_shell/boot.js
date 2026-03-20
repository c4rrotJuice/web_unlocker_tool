import { once, readBootPayload } from "./core/boot.js";
import { initDashboard } from "./pages/dashboard.js";
import { initEditor } from "./pages/editor.js";
import { initInsights } from "./pages/insights.js";
import { initProjects } from "./pages/projects.js";
import { initResearch } from "./pages/research.js";
import { ensureFeedbackRuntime } from "../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES, STATUS_STATES } from "../shared/feedback/feedback_tokens.js";
import { initSidebarShell } from "./core/sidebar.js";

async function initShell(boot) {
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
  if (window.webUnlockerTheme?.initTheme) {
    await window.webUnlockerTheme.initTheme();
  }
  const token = await window.webUnlockerAuth?.getAccessToken?.();
  const authButton = document.getElementById("authButton");
  if (authButton) {
    if (token) {
      authButton.textContent = "Sign out";
      authButton.href = "#";
      authButton.addEventListener("click", async (event) => {
        event.preventDefault();
        if (window.webUnlockerAuth?.client) {
          await window.webUnlockerAuth.client.auth.signOut().catch(() => {});
        }
        window.location.href = "/";
      }, { once: true });
      feedback.status.set(STATUS_SCOPES.SHELL_SESSION, STATUS_STATES.SAVED, { label: "Session ready" });
    } else {
      authButton.textContent = "Sign in";
      authButton.href = `/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      feedback.status.set(STATUS_SCOPES.SHELL_SESSION, STATUS_STATES.ERROR, { label: "Signed out" });
    }
  }
  if (window.webUnlockerAuth?.onAuthStateChange) {
    const { data } = await window.webUnlockerAuth.onAuthStateChange((eventName) => {
      if (eventName === "SIGNED_OUT" || eventName === "TOKEN_REFRESH_FAILED") {
        feedback.emitDomainEvent(FEEDBACK_EVENTS.SESSION_EXPIRED, {
          scope: STATUS_SCOPES.SHELL_SESSION,
          onAction() {
            window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          },
        });
      }
    });
    window.addEventListener("beforeunload", () => {
      data?.subscription?.unsubscribe?.();
    }, { once: true });
  }
  document.title = `${boot.title} · Writior`;
}

async function bootPage() {
  if (!once("app_shell_boot")) return;
  const boot = readBootPayload();
  await initShell(boot);
  await initSidebarShell({ page: boot.page });

  if (boot.page === "dashboard") {
    await initDashboard();
  } else if (boot.page === "projects") {
    await initProjects(boot);
  } else if (boot.page === "editor") {
    await initEditor(boot);
  } else if (boot.page === "research") {
    await initResearch();
  } else if (boot.page === "insights") {
    await initInsights();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPage, { once: true });
} else {
  bootPage();
}
