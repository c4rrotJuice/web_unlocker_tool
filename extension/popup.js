import { BACKEND_BASE_URL } from "./config.js";
import { COPY, mapApiError } from "./lib/messages.js";
import { createToastStatusManager } from "./lib/toast_status.js";

const statusEl = document.getElementById("status");
const toastEl = document.getElementById("toast");
const signedOutPanel = document.getElementById("signed-out");
const signedInPanel = document.getElementById("signed-in");
const signupExtraFields = document.getElementById("signup-extra-fields");
const signupNameInput = document.getElementById("signup-name");
const signupUseCaseInput = document.getElementById("signup-use-case");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login");
const signupButton = document.getElementById("signup");
const logoutButton = document.getElementById("logout");
const upgradeButton = document.getElementById("upgrade");
const openEditorButton = document.getElementById("open-editor");
const openDashboardButton = document.getElementById("open-dashboard");
const enableButton = document.getElementById("enable-copy-cite");
const userEmailEl = document.getElementById("user-email");
const userTierEl = document.getElementById("user-tier");
const remainingEl = document.getElementById("remaining");
const resetAtEl = document.getElementById("reset-at");
const usageInfoEl = document.getElementById("usage-info");
const citationHistoryEl = document.getElementById("citation-history");
const notesListEl = document.getElementById("notes-list");
const tabButtons = Array.from(document.querySelectorAll(".tab-pill"));

const notesFilterTag = document.getElementById("notes-filter-tag");
const notesFilterProject = document.getElementById("notes-filter-project");
const notesFilterSource = document.getElementById("notes-filter-source");
const notesSort = document.getElementById("notes-sort");
const quickNoteTitle = document.getElementById("quick-note-title");
const quickNoteBody = document.getElementById("quick-note-body");
const quickNoteTags = document.getElementById("quick-note-tags");
const quickNoteProject = document.getElementById("quick-note-project");
const saveQuickNoteButton = document.getElementById("save-quick-note");
const cancelQuickNoteButton = document.getElementById("cancel-quick-note");

let signupExpanded = false;
let activeTab = "citations";

const feedback = createToastStatusManager({ toastEl, statusEl });
const setStatus = (message, isError = false) => feedback.setStatus(message, isError ? "error" : "info");
const showToast = (message, isError = false) => feedback.showToast({ message, type: isError ? "error" : "success" });

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) return resolve({ error: chrome.runtime.lastError.message });
      resolve(response);
    });
  });
}

function formatReset(resetAt) {
  if (!resetAt) return "--";
  const date = new Date(resetAt);
  return Number.isNaN(date.getTime()) ? resetAt : date.toLocaleString();
}

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const intervals = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [interval, label] of intervals) {
    const count = Math.floor(seconds / interval);
    if (count >= 1) return `${count} ${label}${count > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

function collapseSignupFields() { signupExpanded = false; signupExtraFields?.classList.add("hidden"); }
function expandSignupFields() { signupExpanded = true; signupExtraFields?.classList.remove("hidden"); }

function renderUsage(usage) {
  if (!usage) return usageInfoEl.classList.add("hidden");
  usageInfoEl.classList.remove("hidden");
  const periodLabel = usage.usage_period === "day" ? "today" : usage.usage_period === "week" ? "this week" : "unlimited";
  remainingEl.textContent = usage.remaining < 0 ? "Unlimited usages" : `${usage.remaining} usages ${periodLabel}`;
  resetAtEl.textContent = usage.remaining < 0 ? "--" : formatReset(usage.reset_at);
}

function renderSessionPanels(session, usage) {
  if (session) {
    signedOutPanel.classList.add("hidden");
    signedInPanel.classList.remove("hidden");
    userEmailEl.textContent = session?.user?.email || "--";
    userTierEl.textContent = usage?.account_type || "Unknown";
  } else {
    signedInPanel.classList.add("hidden");
    signedOutPanel.classList.remove("hidden");
    collapseSignupFields();
  }
  renderUsage(usage);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isRestrictedUrl(url) {
  return !url || ["chrome://", "chrome-extension://", "edge://", "about:", "moz-extension://"].some((p) => url.startsWith(p));
}

async function loadCitationHistory() {
  const sessionState = await sendMessage("get-session");
  if (!sessionState?.session) {
    citationHistoryEl.innerHTML = '<li class="pill-card">Citation history is available for signed-in users.</li>';
    return;
  }
  citationHistoryEl.innerHTML = '<li class="pill-card">Fetching ...</li>';
  const response = await sendMessage("GET_RECENT_CITATIONS", { limit: 5 });
  if (response?.error || !Array.isArray(response?.data)) {
    citationHistoryEl.innerHTML = '<li class="pill-card">Could not load citations.</li>';
    return;
  }
  const citations = response.data.slice(0, 5);
  if (!citations.length) {
    citationHistoryEl.innerHTML = '<li class="pill-card">No recent citations yet.</li>';
    return;
  }
  citationHistoryEl.innerHTML = "";
  citations.forEach((citation) => {
    const li = document.createElement("li");
    li.className = "pill-card";
    const citedAt = citation.cited_at ? new Date(citation.cited_at) : null;
    const timeAgo = citedAt && !Number.isNaN(citedAt.getTime()) ? timeSince(citedAt) : "Recently";
    li.innerHTML = `<div>${citation.excerpt || "No excerpt available"}</div><div class="meta-row"><span class="badge">${timeAgo}</span></div><div class="citation-modal"><p>${citation.full_text || ""}</p><button class="copy-button" type="button">Copy Again</button></div>`;
    li.querySelector(".copy-button")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      try { await navigator.clipboard.writeText(citation.full_text || ""); showToast("Full citation copied!"); } catch { showToast("Failed to copy full citation.", true); }
    });
    citationHistoryEl.appendChild(li);
  });
}

function parseTags(value) {
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

async function loadNotes() {
  const response = await sendMessage("NOTES_LIST", {
    filters: {
      tag: notesFilterTag.value.trim(),
      project: notesFilterProject.value.trim(),
      source: notesFilterSource.value.trim(),
    },
    sort: notesSort.value,
    limit: 100,
  });
  const notes = response?.data?.notes || [];
  const tags = response?.data?.tags || [];
  const projects = response?.data?.projects || [];
  if (!notes.length) {
    notesListEl.innerHTML = '<li class="pill-card">No notes yet.</li>';
    return;
  }
  notesListEl.innerHTML = "";
  notes.forEach((note) => {
    const li = document.createElement("li");
    li.className = "pill-card";
    const tagNames = (note.tags || []).map((id) => tags.find((t) => t.id === id)?.name || id).filter(Boolean);
    const projectName = projects.find((p) => p.id === note.project_id)?.name || "—";
    li.innerHTML = `
      <strong>${note.title || "Untitled note"}</strong>
      <div>${note.highlight_text ? `“${note.highlight_text.slice(0, 130)}”` : ""}</div>
      <div>${note.note_body?.slice(0, 180) || ""}</div>
      <div class="meta-row"><span class="badge">${tagNames.join(", ") || "No tags"}</span><span class="badge">${projectName}</span></div>
      <div class="meta-row"><span>${note.source_url || "No source"}</span><span>${new Date(note.updated_at || note.created_at).toLocaleString()}</span></div>
      <div class="note-actions"><button class="pill mini" data-action="edit">Edit</button><button class="pill mini" data-action="assign">Assign Project</button><button class="pill mini" data-action="delete">Delete</button></div>`;
    li.addEventListener("click", async (event) => {
      const btn = event.target;
      if (!(btn instanceof HTMLElement) || !btn.dataset.action) return;
      if (btn.dataset.action === "delete") {
        await sendMessage("NOTE_DELETE", { id: note.id });
        await loadNotes();
        return;
      }
      if (btn.dataset.action === "assign") {
        const name = window.prompt("Assign project", projectName === "—" ? "" : projectName);
        if (name === null) return;
        await sendMessage("NOTE_UPDATE", { id: note.id, patch: { project: name.trim() } });
        await loadNotes();
        return;
      }
      if (btn.dataset.action === "edit") {
        const updated = window.prompt("Edit note", note.note_body || "");
        if (updated === null) return;
        await sendMessage("NOTE_UPDATE", { id: note.id, patch: { note_body: updated } });
        await loadNotes();
      }
    });
    notesListEl.appendChild(li);
  });
}

function clearQuickNoteForm() {
  quickNoteTitle.value = "";
  quickNoteBody.value = "";
  quickNoteTags.value = "";
  quickNoteProject.value = "";
}

function formatQuickNote(format) {
  const start = quickNoteBody.selectionStart;
  const end = quickNoteBody.selectionEnd;
  const selected = quickNoteBody.value.slice(start, end) || "text";
  const wrappers = { bold: [`**${selected}**`, 2], italic: [`*${selected}*`, 1], bullet: [`- ${selected}`, 2], link: [`[${selected}](https://)`, selected.length + 3] };
  const [replacement, cursor] = wrappers[format] || [selected, 0];
  quickNoteBody.setRangeText(replacement, start, end, "end");
  quickNoteBody.focus();
  quickNoteBody.selectionStart = quickNoteBody.selectionEnd = start + cursor;
}

async function saveQuickNote() {
  const note = {
    title: quickNoteTitle.value.trim(),
    note_body: quickNoteBody.value.trim(),
    tags: parseTags(quickNoteTags.value),
    project: quickNoteProject.value.trim() || null,
    source_url: null,
    highlight_text: null,
  };
  if (!note.note_body) {
    setStatus("Note body is required.", true);
    return;
  }
  const response = await sendMessage("NOTE_SAVE", { note });
  if (response?.error) {
    setStatus(response.error, true);
    return;
  }
  showToast(response?.data?.sync_blocked ? "Saved locally. Sync paused due to plan storage cap." : "Note saved.");
  clearQuickNoteForm();
  await loadNotes();
  await setActiveTab("notes");
}

async function setActiveTab(tab) {
  activeTab = tab;
  await chrome.storage.local.set({ popup_active_tab: tab });
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  ["citations", "notes", "note"].forEach((name) => document.getElementById(`tab-content-${name}`)?.classList.toggle("hidden", name !== tab));
  if (tab === "citations") await loadCitationHistory();
  if (tab === "notes") await loadNotes();
}

async function loadSession() {
  setStatus(COPY.info.VERIFYING_AUTH);
  const response = await sendMessage("get-session");
  if (response?.error) {
    renderSessionPanels(null, null);
    setStatus(`Extension error: ${response.error}`, true);
    return;
  }
  renderSessionPanels(response?.session || null, response?.usage || null);
  setStatus(response?.session ? "Signed in." : "Signed out.");
}

loginButton.addEventListener("click", async () => {
  collapseSignupFields();
  setStatus(COPY.info.PROCESSING_REQUEST);
  try {
    const session = await sendMessage("login", { email: emailInput.value.trim(), password: passwordInput.value });
    if (session?.error) throw new Error(session.error);
    await loadSession();
  } catch (error) {
    const mapped = mapApiError({ message: error.message });
    setStatus(mapped.message, true);
    feedback.showToast({ message: mapped.message, type: mapped.type });
  }
});

signupButton.addEventListener("click", async () => {
  if (!signupExpanded) {
    expandSignupFields();
    setStatus("Enter your full name and use case, then tap Sign up again.");
    return;
  }
  setStatus(COPY.info.PROCESSING_REQUEST);
  try {
    const name = signupNameInput?.value?.trim() || "";
    const useCase = signupUseCaseInput?.value || "";
    if (!name) throw new Error("Full name is required for signup.");
    if (!useCase) throw new Error("Please select a use case.");
    const session = await sendMessage("signup", { name, use_case: useCase, email: emailInput.value.trim(), password: passwordInput.value });
    if (session?.error) throw new Error(session.error);
    await loadSession();
    collapseSignupFields();
    showToast("Account created. Check your email to confirm.");
  } catch (error) {
    const mapped = mapApiError({ message: error.message });
    setStatus(mapped.message, true);
    feedback.showToast({ message: mapped.message, type: mapped.type });
  }
});

logoutButton.addEventListener("click", async () => { setStatus(COPY.info.PROCESSING_REQUEST); await sendMessage("logout"); await loadSession(); });
upgradeButton.addEventListener("click", () => chrome.tabs.create({ url: `${BACKEND_BASE_URL}/static/pricing.html` }));

enableButton.addEventListener("click", async () => {
  setStatus(COPY.info.UNLOCK_STARTED);
  feedback.showToast({ message: COPY.info.FETCHING_CONTENT, type: "loading", duration: 0 });
  try {
    const tab = await getCurrentTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) return setStatus("Cannot run on this page.", true);
    const usage = await sendMessage("check-unlock", { url: tab.url });
    if (usage?.error) return setStatus(`Extension error: ${usage.error}`, true);
    if (usage?.data && !usage.data.allowed) return setStatus("Limit reached. Upgrade for more unlocks.", true);
    const sessionState = await sendMessage("get-session");
    renderSessionPanels(sessionState?.session || null, usage?.data || sessionState?.usage || null);
    if (sessionState?.session) await sendMessage("LOG_USAGE_EVENT", { payload: { url: tab.url, event_id: crypto.randomUUID?.() || `${Date.now()}` } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content/unlock_content.js"] });
    feedback.dismissToast();
    showToast(COPY.success.UNLOCK_SUCCESS);
    setStatus(COPY.success.UNLOCK_SUCCESS);
  } catch {
    setStatus("Failed to inject content script.", true);
  }
});

openEditorButton.addEventListener("click", async () => {
  const sessionState = await sendMessage("get-session");
  if (sessionState?.usage?.account_type === "anonymous") return setStatus("Sign in required for editor access.", true);
  const response = await sendMessage("OPEN_EDITOR");
  if (response?.error || (response?.status && response.status >= 400)) return setStatus(response.error || "Could not open editor.", true);
  setStatus("Opened editor in new tab.");
});
openDashboardButton.addEventListener("click", async () => {
  const response = await sendMessage("OPEN_DASHBOARD");
  if (response?.error || (response?.status && response.status >= 400)) return setStatus(response.error || "Could not open dashboard.", true);
  setStatus("Opened dashboard in new tab.");
});

[notesFilterTag, notesFilterProject, notesFilterSource, notesSort].forEach((el) => el?.addEventListener("input", () => activeTab === "notes" && loadNotes()));
document.querySelectorAll(".format-toolbar [data-format]").forEach((btn) => btn.addEventListener("click", () => formatQuickNote(btn.dataset.format)));
saveQuickNoteButton.addEventListener("click", saveQuickNote);
cancelQuickNoteButton.addEventListener("click", clearQuickNoteForm);
tabButtons.forEach((btn) => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

(async () => {
  await loadSession();
  const persisted = (await chrome.storage.local.get({ popup_active_tab: "citations" })).popup_active_tab;
  await setActiveTab(persisted);
})();
