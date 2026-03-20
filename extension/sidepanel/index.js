import { createSidepanelStore } from "./store.js";
import { renderCaptureTab } from "./tabs/capture.js";
import { renderNotesTab } from "./tabs/notes.js";
import { renderCitationsTab } from "./tabs/citations.js";
import { renderActivityTab } from "./tabs/activity.js";
import { ensureFeedbackRuntime } from "../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES, STATUS_STATES } from "../shared/feedback/feedback_tokens.js";

const store = createSidepanelStore();
const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
const statusEl = document.getElementById("status");
const authStateEl = document.getElementById("auth-state");
const syncStateEl = document.getElementById("sync-state");
const workspaceEl = document.getElementById("workspace");
const signInButton = document.getElementById("open-sign-in");
const openEditorButton = document.getElementById("open-editor");
const openDashboardButton = document.getElementById("open-dashboard");
const syncButton = document.getElementById("sync-now");
const tabs = Array.from(document.querySelectorAll("[data-tab]"));

let activeTab = "capture";
let latestState = null;

function applyStatus(state) {
  const session = state.status?.session || {};
  const sync = state.status?.sync || {};
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  feedback.status.set(
    STATUS_SCOPES.EXTENSION_SESSION,
    session.is_authenticated ? STATUS_STATES.SAVED : STATUS_STATES.ERROR,
    { label: session.is_authenticated ? `Signed in as ${session.email || "account"}` : "Signed out" },
  );
  feedback.status.set(
    STATUS_SCOPES.EXTENSION_SYNC,
    offline ? STATUS_STATES.OFFLINE : (sync.auth_needed || sync.failed ? STATUS_STATES.ERROR : STATUS_STATES.SAVED),
    {
      label: offline
        ? `Offline · ${sync.pending || 0} queued locally`
        : sync.auth_needed
          ? "Sync paused: auth required"
          : `${sync.pending || 0} queued · ${sync.failed || 0} failed`,
    },
  );
  authStateEl.textContent = feedback.status.get(STATUS_SCOPES.EXTENSION_SESSION)?.label || "Signed out";
  syncStateEl.textContent = feedback.status.get(STATUS_SCOPES.EXTENSION_SYNC)?.label || "Ready";
  statusEl.textContent = feedback.status.get(STATUS_SCOPES.EXTENSION_SYNC)?.label || "Workspace ready";
}

function renderTab() {
  if (!latestState) return;
  if (activeTab === "capture") renderCaptureTab(workspaceEl, latestState);
  if (activeTab === "notes") renderNotesTab(workspaceEl, latestState);
  if (activeTab === "citations") renderCitationsTab(workspaceEl, latestState);
  if (activeTab === "activity") renderActivityTab(workspaceEl, latestState);
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.classList.toggle("is-active", selected);
  });
}

async function load() {
  statusEl.textContent = "Loading compact workspace summary…";
  latestState = await store.load();
  applyStatus(latestState);
  renderTab();
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    renderTab();
  });
});

workspaceEl.addEventListener("click", async (event) => {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const draftId = actionEl.getAttribute("data-draft-id");
  if (!draftId) return;
  if (actionEl.dataset.action === "resume-editor-draft") {
    statusEl.textContent = "Resuming editor draft…";
    await store.resumeEditorDraft(draftId);
    await load();
    return;
  }
  if (actionEl.dataset.action === "remove-local-draft") {
    statusEl.textContent = "Clearing local draft…";
    await store.removeLocalDraft(draftId);
    await load();
  }
});

signInButton.addEventListener("click", () => void store.openSignIn());
openEditorButton.addEventListener("click", async () => {
  feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_STARTED, {
    scope: STATUS_SCOPES.SHELL_HANDOFF,
    label: "Opening editor…",
  });
  const response = await store.openEditorFromCurrentPage();
  if (response?.ok) {
    feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_COMPLETED, { scope: STATUS_SCOPES.SHELL_HANDOFF });
    return;
  }
  feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_FAILED, {
    scope: STATUS_SCOPES.SHELL_HANDOFF,
    offline: !!response?.offline,
    message: response?.error || (response?.offline ? "Saved locally for later." : "Unable to open the editor."),
  });
});
openDashboardButton.addEventListener("click", () => void store.openDashboard());
syncButton.addEventListener("click", async () => {
  feedback.emitDomainEvent(FEEDBACK_EVENTS.EXTENSION_SYNC_STARTED);
  const response = await store.syncNow();
  if (response?.ok) {
    feedback.emitDomainEvent(FEEDBACK_EVENTS.EXTENSION_SYNC_COMPLETED, { description: "Queued items replayed." });
  } else {
    feedback.emitDomainEvent(FEEDBACK_EVENTS.EXTENSION_SYNC_FAILED, {
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      message: response?.error || "Retry sync did not complete.",
    });
  }
  await load();
});

void load();

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes?.session) return;
  void load();
});
