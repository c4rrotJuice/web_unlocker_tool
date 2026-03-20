import { createPopupActions } from "./actions.js";
import { renderStatusCard } from "./status_card.js";
import { ensureFeedbackRuntime } from "../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES, STATUS_STATES } from "../shared/feedback/feedback_tokens.js";

const actions = createPopupActions();
const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
const statusEl = document.getElementById("status");
const statusCardEl = document.getElementById("status-card");
const signInButton = document.getElementById("open-sign-in");
const sidepanelButton = document.getElementById("open-sidepanel");
const toggleCaptureUiButton = document.getElementById("toggle-capture-ui");
const workInEditorButton = document.getElementById("work-in-editor");
const syncButton = document.getElementById("sync-now");
let latestStatus = null;

function applyStatus(response) {
  const payload = response?.data || {};
  latestStatus = payload;
  const session = payload.session || {};
  const sync = payload.sync || {};
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  feedback.status.set(
    STATUS_SCOPES.EXTENSION_SESSION,
    session.is_authenticated ? STATUS_STATES.SAVED : STATUS_STATES.ERROR,
    { label: session.is_authenticated ? "Signed in" : "Signed out" },
  );
  feedback.status.set(
    STATUS_SCOPES.EXTENSION_SYNC,
    offline ? STATUS_STATES.OFFLINE : (sync.auth_needed || sync.failed ? STATUS_STATES.ERROR : STATUS_STATES.SAVED),
    {
      label: offline
        ? `Offline · ${sync.pending || 0} queued`
        : sync.auth_needed
          ? "Sync paused: auth required"
          : sync.failed
            ? `${sync.failed} sync issue${sync.failed === 1 ? "" : "s"}`
            : "Ready",
    },
  );
  renderStatusCard(statusCardEl, payload);
  toggleCaptureUiButton.textContent = payload?.capture_ui?.enabled === false ? "Show page tools" : "Hide page tools";
  statusEl.textContent = feedback.status.get(STATUS_SCOPES.EXTENSION_SYNC)?.label || "Ready";
}

async function load() {
  statusEl.textContent = "Loading status…";
  const response = await actions.getStatus();
  applyStatus(response);
}

signInButton.addEventListener("click", () => void actions.openSignIn());
sidepanelButton.addEventListener("click", () => void actions.openSidepanel());
toggleCaptureUiButton.addEventListener("click", async () => {
  const enabledNow = latestStatus?.capture_ui?.enabled !== false;
  await actions.setCaptureUiEnabled(!enabledNow);
  await load();
});
workInEditorButton.addEventListener("click", async () => {
  feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_STARTED, {
    scope: STATUS_SCOPES.SHELL_HANDOFF,
    label: "Opening editor…",
  });
  const response = await actions.workInEditor();
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
syncButton.addEventListener("click", async () => {
  feedback.emitDomainEvent(FEEDBACK_EVENTS.EXTENSION_SYNC_STARTED);
  const response = await actions.syncNow();
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
