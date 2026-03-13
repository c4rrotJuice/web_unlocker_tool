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
const collapsePanelButton = document.getElementById("collapse-panel");
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
let editingNoteId = null;
let editingNoteFocusField = "title";
let editingNoteDraft = null;

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
    li.innerHTML = `<div>${citation.excerpt || "No excerpt available"}</div><div class="meta-row"><span class="badge">${timeAgo}</span></div><div class="citation-modal"><p>${citation.full_citation || citation.full_text || ""}</p><button class="copy-button" type="button">Copy Again</button></div>`;
    li.querySelector(".copy-button")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      try { await navigator.clipboard.writeText(citation.full_citation || citation.full_text || ""); showToast("Full citation copied!"); } catch { showToast("Failed to copy full citation.", true); }
    });
    citationHistoryEl.appendChild(li);
  });
}

function parseTags(value) {
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

function appendTextElement(parent, tagName, text, className = "") {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

function placeCursorAtEnd(el) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getEditableText(el) {
  return (el.textContent || "").replace(/\u00a0/g, " ").trim();
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
    const isEditing = editingNoteId === note.id;
    if (isEditing) {
      li.classList.add("note-editing");
      editingNoteDraft ||= {
        title: note.title || "",
        highlight_text: note.highlight_text || "",
        note_body: note.note_body || "",
        project: projectName === "—" ? "" : projectName,
      };
    }

    if (isEditing) {
      const editControls = document.createElement("div");
      editControls.className = "note-edit-controls";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "pill mini pill-primary";
      saveBtn.textContent = "✓ Save";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "pill mini";
      cancelBtn.textContent = "✕ Cancel";

      editControls.append(saveBtn, cancelBtn);
      li.appendChild(editControls);

      const titleEl = document.createElement("strong");
      titleEl.className = "note-title note-editable";
      titleEl.contentEditable = "true";
      titleEl.textContent = editingNoteDraft.title || "Untitled note";
      li.appendChild(titleEl);

      const highlightEl = appendTextElement(li, "div", editingNoteDraft.highlight_text, "note-highlight note-editable");
      highlightEl.contentEditable = "true";

      const bodyEl = appendTextElement(li, "div", editingNoteDraft.note_body, "note-body note-editable");
      bodyEl.contentEditable = "true";

      const projectWrap = document.createElement("label");
      projectWrap.className = "note-project-input";
      projectWrap.textContent = "Project";
      const projectInput = document.createElement("input");
      projectInput.type = "text";
      projectInput.value = editingNoteDraft.project || "";
      projectInput.placeholder = "No project";
      projectWrap.appendChild(projectInput);
      li.appendChild(projectWrap);

      titleEl.addEventListener("input", () => { editingNoteDraft.title = getEditableText(titleEl); });
      highlightEl.addEventListener("input", () => { editingNoteDraft.highlight_text = getEditableText(highlightEl); });
      bodyEl.addEventListener("input", () => { editingNoteDraft.note_body = getEditableText(bodyEl); });
      projectInput.addEventListener("input", () => { editingNoteDraft.project = projectInput.value.trim(); });

      saveBtn.addEventListener("click", async () => {
        await sendMessage("NOTE_UPDATE", {
          id: note.id,
          patch: {
            title: (editingNoteDraft.title || "").trim() || null,
            highlight_text: (editingNoteDraft.highlight_text || "").trim() || null,
            note_body: (editingNoteDraft.note_body || "").trim() || null,
            project: (editingNoteDraft.project || "").trim() || null,
          },
        });
        editingNoteId = null;
        editingNoteDraft = null;
        await loadNotes();
      });

      cancelBtn.addEventListener("click", async () => {
        editingNoteId = null;
        editingNoteDraft = null;
        await loadNotes();
      });

      const focusTarget = editingNoteFocusField === "project" ? projectInput : titleEl;
      queueMicrotask(() => {
        focusTarget.focus();
        if (focusTarget instanceof HTMLElement && focusTarget.isContentEditable) {
          placeCursorAtEnd(focusTarget);
        }
      });
    } else {
      const titleEl = document.createElement("strong");
      titleEl.className = "note-title";
      titleEl.textContent = note.title || "Untitled note";
      li.appendChild(titleEl);

      appendTextElement(li, "div", note.highlight_text ? `“${note.highlight_text.slice(0, 130)}”` : "", "note-highlight");
      appendTextElement(li, "div", note.note_body?.slice(0, 180) || "", "note-body");
    }

    const badgesRow = document.createElement("div");
    badgesRow.className = "meta-row";
    appendTextElement(badgesRow, "span", tagNames.join(", ") || "No tags", "badge");
    appendTextElement(badgesRow, "span", projectName, "badge");
    li.appendChild(badgesRow);

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";
    appendTextElement(metaRow, "span", note.source_url || "No source");
    appendTextElement(metaRow, "span", new Date(note.updated_at || note.created_at).toLocaleString());
    li.appendChild(metaRow);

    if (!isEditing) {
      const actions = document.createElement("div");
      actions.className = "note-actions";
      [
        { action: "edit", label: "Edit" },
        { action: "assign", label: "Assign Project" },
        { action: "delete", label: "Delete" },
      ].forEach(({ action, label }) => {
        const button = document.createElement("button");
        button.className = "pill mini";
        button.dataset.action = action;
        button.type = "button";
        button.textContent = label;
        actions.appendChild(button);
      });
      li.appendChild(actions);

      li.addEventListener("click", async (event) => {
        const btn = event.target;
        if (!(btn instanceof HTMLElement) || !btn.dataset.action) return;
        if (btn.dataset.action === "delete") {
          await sendMessage("NOTE_DELETE", { id: note.id });
          await loadNotes();
          return;
        }
        if (btn.dataset.action === "edit" || btn.dataset.action === "assign") {
          editingNoteId = note.id;
          editingNoteFocusField = btn.dataset.action === "assign" ? "project" : "title";
          editingNoteDraft = {
            title: note.title || "",
            highlight_text: note.highlight_text || "",
            note_body: note.note_body || "",
            project: projectName === "—" ? "" : projectName,
          };
          await loadNotes();
        }
      });
    }
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


collapsePanelButton?.addEventListener("click", async () => {
  await chrome.storage.local.set({ writior_panel_collapsed: true });
  window.close();
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
