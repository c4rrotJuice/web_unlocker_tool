import { STORAGE_KEYS } from "../../shared/constants/storage_keys.ts";
import { normalizeCapabilitySurface } from "../../shared/types/capability_surface.ts";
import { createSidepanelClient } from "../messaging/client.ts";
import { createNewNoteView } from "../new_note_view.ts";
import { summarizeNote } from "../components/list_rows.ts";
import {
  createActionButtonRow,
  createCitationListRow,
  createDocumentListRow,
  createEmptyState,
  createErrorState,
  createGatedState,
  createListPane,
  createNoteListRow,
  createPanelHeader,
  createQuoteListRow,
  createSidepanelTabs,
  createUsageGaugeRow,
} from "../components/index.ts";
import { createSidepanelStateStore, SIDEPANEL_STATUS, SIDEPANEL_TABS, TAB_LOAD_STATUS } from "./state.ts";

function normalizeTabContext(tab: any = {}) {
  const pageUrl = typeof tab?.url === "string" ? tab.url.trim() : "";
  const pageTitle = typeof tab?.title === "string" ? tab.title.trim() : "";
  let pageDomain = "";
  try {
    pageDomain = pageUrl ? new URL(pageUrl).hostname.toLowerCase() : "";
  } catch {}
  return { pageTitle, pageUrl, pageDomain };
}

async function resolveActiveTabContext(chromeApi) {
  if (typeof chromeApi?.tabs?.query !== "function") {
    return null;
  }
  try {
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return normalizeTabContext(tabs?.[0] || null);
  } catch {
    return null;
  }
}

function describePageContext(pageContext) {
  if (!pageContext?.pageUrl) {
    return "Current page context attaches automatically when available.";
  }
  return [pageContext.pageTitle || "Current page", pageContext.pageDomain || pageContext.pageUrl].filter(Boolean).join(" • ");
}

function normalizeText(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trimText(value: any) {
  return String(value || "").trim();
}

function getNoteCopyText(note: any = {}, draft = undefined) {
  const title = trimText(draft?.title ?? note?.title ?? "");
  const body = String(draft?.note_body ?? note?.note_body ?? "").trim();
  return [title, body].filter(Boolean).join("\n\n");
}

function createShellStyles(documentRef) {
  const style = documentRef.createElement("style");
  style.textContent = `
    :host { display: block; min-height: 100vh; }
    :host, :host * { box-sizing: border-box; }
    .writior-sidepanel-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      min-height: 100vh;
      max-height: 100vh;
      padding: 12px;
      background:
        radial-gradient(circle at top left, rgba(30, 41, 59, 0.9), transparent 42%),
        linear-gradient(180deg, #020617 0%, #0f172a 48%, #111827 100%);
      color: #e2e8f0;
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    }
    .writior-sidepanel-top-shell {
      display: grid;
      gap: 10px;
      padding: 14px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.9);
    }
    .writior-sidepanel-workspace {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-height: 0;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.72);
      overflow: hidden;
    }
    .writior-sidepanel-workspace-top {
      padding: 10px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    }
    .writior-sidepanel-workspace-body {
      min-height: 0;
      overflow: hidden;
    }
  `;
  return style;
}

function renderSnapshotBody(snapshot) {
  const surface = normalizeCapabilitySurface({ auth: snapshot });
  const signedIn = snapshot?.status === "signed_in" || snapshot?.status === "refreshing";
  const identity = signedIn
    ? snapshot?.bootstrap?.profile?.display_name || snapshot?.session?.email || "Signed in"
    : "Not signed in";
  const usageText = surface.usageItems.length
    ? surface.usageItems.map((item) => `${item.value} ${item.label}`).join(" • ")
    : "Usage unavailable";
  return `
    <section data-surface="sidepanel-snapshot">
      <h1>Writior</h1>
      <p>${identity}</p>
      <p>Tier ${surface.tierLabel || "Guest"}</p>
      <p>${usageText}</p>
    </section>
  `;
}

export function renderSidepanelAuthSnapshot(root, snapshot) {
  if (!root) {
    return { mounted: false };
  }
  root.innerHTML = renderSnapshotBody(snapshot);
  return { mounted: true };
}

function createNoticeNode(documentRef) {
  const node = documentRef.createElement("div");
  node.setAttribute("data-status-banner", "true");
  node.style.display = "none";
  node.style.padding = "10px 12px";
  node.style.borderRadius = "12px";
  node.style.fontSize = "12px";
  node.style.lineHeight = "1.4";
  return node;
}

function createListLoadingState(documentRef, label) {
  return createEmptyState({
    documentRef,
    title: `Loading ${label}`,
    body: `${label} are being loaded from the canonical extension runtime.`,
  });
}

function createSignedInTabDefaults(stateStore) {
  stateStore.updateTab(SIDEPANEL_TABS.CITATIONS, { status: TAB_LOAD_STATUS.IDLE, items: [], message: "" });
  stateStore.updateTab(SIDEPANEL_TABS.NOTES, { status: TAB_LOAD_STATUS.IDLE, items: [], message: "" });
  stateStore.updateTab(SIDEPANEL_TABS.DOCS, {
    status: TAB_LOAD_STATUS.UNAVAILABLE,
    items: [],
    message: "Documents stay canonical in the web editor. Use Open Editor to continue writing.",
  });
  stateStore.updateTab(SIDEPANEL_TABS.NEW_NOTE, { status: TAB_LOAD_STATUS.READY, items: [], message: "" });
  stateStore.updateTab(SIDEPANEL_TABS.QUOTES, {
    status: TAB_LOAD_STATUS.UNAVAILABLE,
    items: [],
    message: "Quotes list hydration is not exposed by the current background contract.",
  });
}

export function createSidepanelShell(options: any = {}) {
  const {
    root,
    documentRef = globalThis.document,
    chromeApi = globalThis.chrome,
    navigatorRef = globalThis.navigator,
    client = createSidepanelClient(chromeApi),
  } = options;
  if (!root) {
    throw new Error("createSidepanelShell requires a root element.");
  }

  const host = typeof root.attachShadow === "function" ? root.attachShadow({ mode: "open" }) : root;
  const stateStore = createSidepanelStateStore();
  const notePreviewState = {
    noteId: null,
    mode: "closed",
    locked: false,
    draftTitle: "",
    draftBody: "",
    error: "",
    saving: false,
    top: 8,
    pendingFocusAttr: "",
  };

  const shell = documentRef.createElement("section");
  shell.className = "writior-sidepanel-shell";
  const topShell = documentRef.createElement("section");
  topShell.className = "writior-sidepanel-top-shell";
  topShell.setAttribute("data-top-shell", "true");
  const workspace = documentRef.createElement("section");
  workspace.className = "writior-sidepanel-workspace";
  const workspaceTop = documentRef.createElement("div");
  workspaceTop.className = "writior-sidepanel-workspace-top";
  const workspaceBody = documentRef.createElement("div");
  workspaceBody.className = "writior-sidepanel-workspace-body";
  workspaceBody.setAttribute("data-workspace-body", "true");

  const header = createPanelHeader({ documentRef });
  const usageRow = createUsageGaugeRow({ documentRef });
  const notice = createNoticeNode(documentRef);
  const actionRow = createActionButtonRow({
    documentRef,
    onOpenEditor: async () => {
      const result = await client.openEditor?.();
      stateStore.setNotice(result?.ok
        ? { tone: "info", message: "Opening editor..." }
        : { tone: "error", message: result?.error?.message || "Editor launch failed." });
      render();
    },
    onOpenDashboard: async () => {
      const result = await client.openDashboard?.();
      stateStore.setNotice(result?.ok
        ? { tone: "info", message: "Opening dashboard..." }
        : { tone: "error", message: result?.error?.message || "Dashboard launch failed." });
      render();
    },
    onSignIn: async () => {
      stateStore.setState({ status: SIDEPANEL_STATUS.LOADING });
      stateStore.setNotice({ tone: "info", message: "Starting sign in..." });
      render();
      const result = await client.authStart?.({
        trigger: "sidepanel_sign_in",
        redirectPath: "/dashboard",
      });
      if (result?.ok) {
        stateStore.setAuth(result.data?.auth || null);
        createSignedInTabDefaults(stateStore);
        stateStore.setNotice({ tone: "info", message: "Signed in." });
        render();
        await ensureTabHydrated(stateStore.getState().active_tab, true);
      } else {
        stateStore.setNotice({ tone: "error", message: result?.error?.message || "Sign in failed." });
        render();
      }
    },
    onSignOut: async () => {
      const result = await client.authLogout?.();
      if (result?.ok) {
        stateStore.setAuth(result.data?.auth || null);
        stateStore.resetSignedOutTabs();
        stateStore.setNotice({ tone: "info", message: "Signed out." });
      } else {
        stateStore.setNotice({ tone: "error", message: result?.error?.message || "Sign out failed." });
      }
      render();
    },
  });
  const tabs = createSidepanelTabs({
    documentRef,
    tabs: [
      { key: SIDEPANEL_TABS.CITATIONS, label: "Cites" },
      { key: SIDEPANEL_TABS.NOTES, label: "Notes" },
      { key: SIDEPANEL_TABS.DOCS, label: "Docs" },
      { key: SIDEPANEL_TABS.NEW_NOTE, label: "New Note" },
      { key: SIDEPANEL_TABS.QUOTES, label: "Quotes" },
    ],
    activeTab: SIDEPANEL_TABS.CITATIONS,
    onSelect: (activeTab) => {
      stateStore.setActiveTab(activeTab);
      render();
      void ensureTabHydrated(activeTab);
    },
  });
  const listPane = createListPane({ documentRef });
  const newNoteView = createNewNoteView({
    documentRef,
    onOpen: async () => {
      const pageContext = await resolveActiveTabContext(chromeApi);
      stateStore.setState({
        active_tab: SIDEPANEL_TABS.NEW_NOTE,
        noteStatus: "editing",
        noteError: "",
        pageContext,
      });
      render();
      newNoteView.focusInput();
    },
    onCancel: () => {
      stateStore.setState({
        noteStatus: "closed",
        noteText: "",
        noteError: "",
      });
      render();
    },
    onInput: (value) => {
      stateStore.setState({ noteText: value, noteStatus: "editing", noteError: "" });
      render();
    },
    onSubmit: async () => {
      const state = stateStore.getState();
      if (!normalizeText(state.noteText)) {
        stateStore.setState({ noteStatus: "error", noteError: "Write a note before saving." });
        render();
        return;
      }
      const pageContext = state.pageContext || await resolveActiveTabContext(chromeApi);
      stateStore.setState({
        noteStatus: "saving",
        pageContext,
      });
      render();
      const result = await client.createNote?.({
        noteText: state.noteText,
        capture: pageContext?.pageUrl
          ? { pageTitle: pageContext.pageTitle, pageUrl: pageContext.pageUrl, selectionText: "" }
          : undefined,
      });
      if (result?.ok) {
        stateStore.setState({
          noteStatus: "success",
          noteText: "",
          noteError: "",
        });
        stateStore.updateTab(SIDEPANEL_TABS.NOTES, { status: TAB_LOAD_STATUS.IDLE, items: [], message: "" });
        stateStore.setNotice({ tone: "info", message: "Note saved." });
      } else {
        stateStore.setState({
          noteStatus: "error",
          noteError: result?.error?.message || "Note save failed.",
        });
      }
      render();
    },
  });

  topShell.append(header.root, usageRow.root, actionRow.root, notice);
  workspaceTop.appendChild(tabs.root);
  workspace.append(workspaceTop, workspaceBody);
  shell.append(topShell, workspace);

  const style = createShellStyles(documentRef);
  host.replaceChildren(style, shell);

  function setNotice() {
    const currentNotice = stateStore.getState().notice;
    if (!currentNotice?.message) {
      notice.style.display = "none";
      notice.textContent = "";
      return;
    }
    notice.style.display = "block";
    notice.textContent = currentNotice.message;
    if (currentNotice.tone === "error") {
      notice.style.border = "1px solid rgba(248, 113, 113, 0.26)";
      notice.style.background = "rgba(69, 10, 10, 0.3)";
      notice.style.color = "#fecaca";
    } else {
      notice.style.border = "1px solid rgba(148, 163, 184, 0.14)";
      notice.style.background = "rgba(15, 23, 42, 0.6)";
      notice.style.color = "#cbd5e1";
    }
  }

  async function loadAuth() {
    const result = await client.authStatusGet?.();
    if (result?.ok) {
      stateStore.setAuth(result.data?.auth || null);
      return result.data?.auth || null;
    }
    stateStore.setState({
      status: SIDEPANEL_STATUS.ERROR,
      notice: { tone: "error", message: result?.error?.message || "Failed to load sidepanel state." },
    });
    return null;
  }

  async function ensureTabHydrated(tabKey, force = false) {
    const state = stateStore.getState();
    const signedIn = state.auth?.status === "signed_in";
    if (!signedIn) {
      stateStore.resetSignedOutTabs();
      render();
      return;
    }
    if (tabKey === SIDEPANEL_TABS.NEW_NOTE || tabKey === SIDEPANEL_TABS.DOCS || tabKey === SIDEPANEL_TABS.QUOTES) {
      render();
      return;
    }

    const tabState = state.tabs?.[tabKey];
    if (!force && (tabState?.status === TAB_LOAD_STATUS.READY || tabState?.status === TAB_LOAD_STATUS.LOADING)) {
      return;
    }
    stateStore.updateTab(tabKey, { status: TAB_LOAD_STATUS.LOADING, message: "" });
    render();

    const result = tabKey === SIDEPANEL_TABS.CITATIONS
      ? await client.listRecentCitations?.({ limit: 8 })
      : await client.listRecentNotes?.({ limit: 8 });

    if (result?.ok) {
      stateStore.updateTab(tabKey, {
        status: TAB_LOAD_STATUS.READY,
        items: Array.isArray(result.data?.items) ? result.data.items : [],
        message: "",
      });
    } else {
      stateStore.updateTab(tabKey, {
        status: TAB_LOAD_STATUS.ERROR,
        items: [],
        message: result?.error?.message || "List hydration failed.",
      });
    }
    render();
  }

  function bindPreview(row, summary, index) {
    const show = () => listPane.preview.render({
      title: summary.title,
      meta: summary.meta,
      body: summary.body,
      top: 12 + (index * 56),
    });
    row.addEventListener("mouseenter", show);
    row.addEventListener("focusin", show);
    row.addEventListener("mouseleave", () => listPane.preview.hide(120));
    row.addEventListener("focusout", () => listPane.preview.hide(120));
  }

  function getNotesItems() {
    const notesTab = stateStore.getState().tabs?.[SIDEPANEL_TABS.NOTES];
    return Array.isArray(notesTab?.items) ? notesTab.items : [];
  }

  function getNoteById(noteId) {
    return getNotesItems().find((item) => item?.id === noteId) || null;
  }

  function findByAttribute(node, name, value) {
    if (!node) {
      return null;
    }
    if (typeof node.getAttribute === "function" && node.getAttribute(name) === value) {
      return node;
    }
    for (const child of node.children || []) {
      const match = findByAttribute(child, name, value);
      if (match) {
        return match;
      }
    }
    return null;
  }

  async function copyNotePreview(note, draft = undefined) {
    try {
      await navigatorRef?.clipboard?.writeText?.(getNoteCopyText(note, draft));
      stateStore.setNotice({ tone: "info", message: "Note copied." });
    } catch (error) {
      stateStore.setNotice({ tone: "error", message: error?.message || "Copy failed." });
    }
    render();
  }

  function hideNotePreview(force = false) {
    if (force) {
      notePreviewState.noteId = null;
      notePreviewState.mode = "closed";
      notePreviewState.locked = false;
      notePreviewState.error = "";
      notePreviewState.saving = false;
      notePreviewState.pendingFocusAttr = "";
      listPane.preview.clear(true);
      return;
    }
    if (notePreviewState.mode === "edit" || notePreviewState.saving || notePreviewState.locked) {
      return;
    }
    listPane.preview.hide(120);
  }

  function renderNotePreview() {
    const note = getNoteById(notePreviewState.noteId);
    if (!note || stateStore.getState().active_tab !== SIDEPANEL_TABS.NOTES) {
      hideNotePreview(true);
      return;
    }

    const inEditMode = notePreviewState.mode === "edit";
    const draft = {
      title: notePreviewState.draftTitle,
      note_body: notePreviewState.draftBody,
    };
    const summary = summarizeNote(note);
    const container = documentRef.createElement("div");
    container.style.display = "grid";
    container.style.gap = "10px";

    const title = documentRef.createElement("div");
    title.style.fontSize = "14px";
    title.style.fontWeight = "700";
    title.style.lineHeight = "1.35";
    title.style.color = "#f8fafc";

    const meta = documentRef.createElement("div");
    meta.style.fontSize = "11px";
    meta.style.lineHeight = "1.4";
    meta.style.color = inEditMode ? "#bbf7d0" : "#94a3b8";
    meta.textContent = summary.meta || "";

    const message = documentRef.createElement("div");
    message.style.fontSize = "11px";
    message.style.lineHeight = "1.4";
    message.style.color = inEditMode ? "#86efac" : "#cbd5e1";
    message.textContent = inEditMode
      ? (notePreviewState.error || (notePreviewState.saving ? "Saving note..." : "Edit mode is locked to this preview."))
      : "";

    const controls = documentRef.createElement("div");
    controls.style.display = "flex";
    controls.style.flexWrap = "wrap";
    controls.style.gap = "8px";

    function createActionButton(label, attrs = {}) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.textContent = label;
      Object.entries(attrs).forEach(([name, value]) => button.setAttribute(name, String(value)));
      button.style.padding = "7px 10px";
      button.style.borderRadius = "999px";
      button.style.border = inEditMode
        ? "1px solid rgba(134, 239, 172, 0.32)"
        : "1px solid rgba(148, 163, 184, 0.22)";
      button.style.background = inEditMode ? "rgba(240, 253, 244, 0.14)" : "rgba(15, 23, 42, 0.64)";
      button.style.color = "#f8fafc";
      return button;
    }

    async function saveNotePreviewEdits() {
      const currentNote = getNoteById(notePreviewState.noteId);
      if (!currentNote) {
        hideNotePreview(true);
        return;
      }
      const titleValue = trimText(notePreviewState.draftTitle);
      const bodyValue = trimText(notePreviewState.draftBody);
      if (!titleValue || !bodyValue) {
        notePreviewState.error = "Title and note body are required.";
        notePreviewState.saving = false;
        renderNotePreview();
        return;
      }
      notePreviewState.error = "";
      notePreviewState.saving = true;
      renderNotePreview();
      const result = await client.updateNote?.({
        noteId: currentNote.id,
        title: titleValue,
        note_body: bodyValue,
      });
      if (!result?.ok) {
        notePreviewState.saving = false;
        notePreviewState.error = result?.error?.message || "Note update failed.";
        renderNotePreview();
        return;
      }
      const savedNote = result.data?.note || currentNote;
      const nextItems = getNotesItems().map((item) => item?.id === savedNote?.id ? savedNote : item);
      stateStore.updateTab(SIDEPANEL_TABS.NOTES, {
        status: TAB_LOAD_STATUS.READY,
        items: nextItems,
        message: "",
      });
      notePreviewState.mode = "read";
      notePreviewState.locked = false;
      notePreviewState.saving = false;
      notePreviewState.error = "";
      notePreviewState.draftTitle = savedNote?.title || "";
      notePreviewState.draftBody = savedNote?.note_body || "";
      stateStore.setNotice({ tone: "info", message: "Note saved." });
      render();
      renderNotePreview();
    }

    function cancelNotePreviewEdits() {
      notePreviewState.mode = "read";
      notePreviewState.locked = false;
      notePreviewState.saving = false;
      notePreviewState.error = "";
      notePreviewState.draftTitle = note?.title || "";
      notePreviewState.draftBody = note?.note_body || "";
      renderNotePreview();
    }

    function handleEditorHotkeys(event) {
      if (event.key === "Escape") {
        event.preventDefault?.();
        cancelNotePreviewEdits();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault?.();
        void saveNotePreviewEdits();
      }
    }

    if (inEditMode) {
      title.textContent = "Editing note";

      const titleInput = documentRef.createElement("input");
      titleInput.type = "text";
      titleInput.value = notePreviewState.draftTitle;
      titleInput.setAttribute("data-note-preview-title-input", "true");
      titleInput.style.width = "100%";
      titleInput.style.padding = "9px 10px";
      titleInput.style.borderRadius = "10px";
      titleInput.style.border = "1px solid rgba(134, 239, 172, 0.3)";
      titleInput.style.background = "rgba(240, 253, 244, 0.12)";
      titleInput.style.color = "#f0fdf4";
      titleInput.addEventListener("input", () => {
        notePreviewState.draftTitle = titleInput.value;
        if (notePreviewState.error) {
          notePreviewState.error = "";
          renderNotePreview();
        }
      });
      titleInput.addEventListener("keydown", handleEditorHotkeys);

      const bodyInput = documentRef.createElement("textarea");
      bodyInput.value = notePreviewState.draftBody;
      bodyInput.setAttribute("data-note-preview-body-input", "true");
      bodyInput.style.width = "100%";
      bodyInput.style.minHeight = "160px";
      bodyInput.style.padding = "10px";
      bodyInput.style.borderRadius = "12px";
      bodyInput.style.border = "1px solid rgba(134, 239, 172, 0.3)";
      bodyInput.style.background = "rgba(240, 253, 244, 0.12)";
      bodyInput.style.color = "#f0fdf4";
      bodyInput.style.resize = "vertical";
      bodyInput.style.whiteSpace = "pre-wrap";
      bodyInput.addEventListener("input", () => {
        notePreviewState.draftBody = bodyInput.value;
        if (notePreviewState.error) {
          notePreviewState.error = "";
          renderNotePreview();
        }
      });
      bodyInput.addEventListener("keydown", handleEditorHotkeys);

      const copy = createActionButton("Copy", { "data-note-preview-copy": "true" });
      copy.disabled = notePreviewState.saving;
      copy.addEventListener("click", () => {
        void copyNotePreview(note, {
          title: notePreviewState.draftTitle,
          note_body: notePreviewState.draftBody,
        });
      });

      const save = createActionButton("Save", { "data-note-preview-save": "true" });
      save.disabled = notePreviewState.saving;
      save.addEventListener("click", () => {
        void saveNotePreviewEdits();
      });

      const cancel = createActionButton("Cancel", { "data-note-preview-cancel": "true" });
      cancel.disabled = notePreviewState.saving;
      cancel.addEventListener("click", () => {
        cancelNotePreviewEdits();
      });

      controls.append(copy, save, cancel);
      container.append(title, meta, message, titleInput, bodyInput, controls);
    } else {
      title.textContent = summary.title || "Untitled note";

      const body = documentRef.createElement("div");
      body.style.fontSize = "12px";
      body.style.lineHeight = "1.5";
      body.style.color = "#cbd5e1";
      body.style.whiteSpace = "pre-wrap";
      body.style.wordBreak = "break-word";
      body.style.overflowWrap = "anywhere";
      body.textContent = note.note_body || note.highlight_text || "Note preview unavailable.";

      const copy = createActionButton("Copy", { "data-note-preview-copy": "true" });
      copy.addEventListener("click", () => {
        void copyNotePreview(note);
      });

      const edit = createActionButton("Edit", { "data-note-preview-edit": "true" });
      edit.addEventListener("click", () => {
        notePreviewState.mode = "edit";
        notePreviewState.locked = true;
        notePreviewState.saving = false;
        notePreviewState.error = "";
        notePreviewState.draftTitle = note.title || "";
        notePreviewState.draftBody = note.note_body || "";
        notePreviewState.pendingFocusAttr = "data-note-preview-title-input";
        renderNotePreview();
      });

      controls.append(copy, edit);
      container.append(title, meta, body, controls);
    }

    listPane.preview.mount(container, {
      top: notePreviewState.top,
      pinned: inEditMode || notePreviewState.saving || notePreviewState.locked,
      tone: inEditMode ? "edit" : "default",
    });
    if (notePreviewState.pendingFocusAttr) {
      const focusTarget = findByAttribute(container, notePreviewState.pendingFocusAttr, "true");
      notePreviewState.pendingFocusAttr = "";
      focusTarget?.focus?.();
    }
  }

  function showNotePreview(note, index, options: any = {}) {
    if (!note?.id) {
      return;
    }
    if ((notePreviewState.mode === "edit" || notePreviewState.saving) && notePreviewState.noteId !== note.id && !options.force) {
      return;
    }
    notePreviewState.noteId = note.id;
    notePreviewState.top = 12 + (index * 56);
    notePreviewState.locked = Boolean(options.locked);
    if (notePreviewState.mode !== "edit") {
      notePreviewState.mode = "read";
      notePreviewState.error = "";
      notePreviewState.saving = false;
      notePreviewState.draftTitle = note.title || "";
      notePreviewState.draftBody = note.note_body || "";
    }
    renderNotePreview();
  }

  function buildCitationRows(items = []) {
    return items.map((citation, index) => {
      const entry = createCitationListRow({ documentRef, citation });
      bindPreview(entry.root, entry.summary, index);
      entry.root.addEventListener("click", async (event: any) => {
        event.preventDefault?.();
        try {
          const citationText = citation?.renders?.apa?.bibliography
            || citation?.renders?.mla?.bibliography
            || citation?.quote_text
            || citation?.excerpt
            || entry.summary.body
            || "";
          await navigatorRef?.clipboard?.writeText?.(citationText);
          stateStore.setNotice({ tone: "info", message: "Citation copied." });
        } catch (error) {
          stateStore.setNotice({ tone: "error", message: error?.message || "Copy failed." });
        }
        render();
      });
      return entry.root;
    });
  }

  function buildNoteRows(items = []) {
    return items.map((note, index) => {
      const entry = createNoteListRow({ documentRef, note });
      const show = () => showNotePreview(note, index);
      entry.root.addEventListener("mouseenter", show);
      entry.root.addEventListener("focusin", show);
      entry.root.addEventListener("mouseleave", () => hideNotePreview());
      entry.root.addEventListener("focusout", () => hideNotePreview());
      entry.root.addEventListener("keydown", (event: any) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault?.();
        notePreviewState.pendingFocusAttr = "data-note-preview-copy";
        showNotePreview(note, index, { force: true, locked: true });
      });
      return entry.root;
    });
  }

  function buildDocumentRows(items = []) {
    return items.map((documentItem, index) => {
      const entry = createDocumentListRow({ documentRef, documentItem });
      bindPreview(entry.root, entry.summary, index);
      entry.root.addEventListener("click", (event: any) => {
        event.preventDefault?.();
        void client.openEditor?.();
      });
      return entry.root;
    });
  }

  function buildQuoteRows(items = []) {
    return items.map((quote, index) => {
      const entry = createQuoteListRow({ documentRef, quote });
      bindPreview(entry.root, entry.summary, index);
      return entry.root;
    });
  }

  function renderListTab(tabKey) {
    if (tabKey !== SIDEPANEL_TABS.NOTES) {
      hideNotePreview(true);
    }
    const state = stateStore.getState();
    const tabState = state.tabs?.[tabKey] || { status: TAB_LOAD_STATUS.IDLE, items: [], message: "" };
    if (tabState.status === TAB_LOAD_STATUS.LOADING) {
      listPane.setContent([createListLoadingState(documentRef, tabKey === SIDEPANEL_TABS.CITATIONS ? "citations" : "notes")]);
      return;
    }
    if (tabState.status === TAB_LOAD_STATUS.GATED) {
      listPane.setContent([createGatedState({
        documentRef,
        title: "Workspace locked",
        body: tabState.message || "Sign in to load this workspace tab.",
      })]);
      return;
    }
    if (tabState.status === TAB_LOAD_STATUS.ERROR) {
      listPane.setContent([createErrorState({
        documentRef,
        title: "Unable to load items",
        body: tabState.message || "The background runtime could not load this list.",
      })]);
      return;
    }
    if (tabState.status === TAB_LOAD_STATUS.UNAVAILABLE) {
      listPane.setContent([createEmptyState({
        documentRef,
        title: tabKey === SIDEPANEL_TABS.DOCS ? "Open documents in editor" : "Quotes list unavailable",
        body: tabState.message || "This tab is not currently hydrated from the background runtime.",
      })]);
      return;
    }

    const items = Array.isArray(tabState.items) ? tabState.items : [];
    if (!items.length) {
      listPane.setContent([createEmptyState({
        documentRef,
        title: tabKey === SIDEPANEL_TABS.CITATIONS ? "No recent citations" : tabKey === SIDEPANEL_TABS.NOTES ? "No recent notes" : "No items yet",
        body: tabKey === SIDEPANEL_TABS.CITATIONS
          ? "Recent citations appear here after capture and bootstrap hydration."
          : "Recent notes appear here after save and bootstrap hydration.",
      })]);
      return;
    }

    if (tabKey === SIDEPANEL_TABS.CITATIONS) {
      listPane.setContent(buildCitationRows(items));
      return;
    }
    if (tabKey === SIDEPANEL_TABS.NOTES) {
      listPane.setContent(buildNoteRows(items));
      return;
    }
    if (tabKey === SIDEPANEL_TABS.DOCS) {
      listPane.setContent(buildDocumentRows(items));
      return;
    }
    listPane.setContent(buildQuoteRows(items));
  }

  function renderWorkspaceBody() {
    const state = stateStore.getState();
    if (state.active_tab === SIDEPANEL_TABS.NEW_NOTE) {
      const signedIn = state.auth?.status === "signed_in";
      if (!signedIn) {
        workspaceBody.replaceChildren(createGatedState({
          documentRef,
          title: "Sign in to save notes",
          body: "The note composer stays in place, but saving into the canonical workspace requires a signed-in session.",
        }));
        return;
      }
      newNoteView.render({
        status: state.noteStatus,
        noteText: state.noteText,
        errorMessage: state.noteError,
        pageContextText: describePageContext(state.pageContext),
      });
      workspaceBody.replaceChildren(newNoteView.root);
      return;
    }
    renderListTab(state.active_tab);
    workspaceBody.replaceChildren(listPane.root);
  }

  function render() {
    const state = stateStore.getState();
    const surface = normalizeCapabilitySurface({ auth: state.auth });
    header.render({
      profile: state.auth?.bootstrap?.profile || null,
      fallbackEmail: state.auth?.session?.email || "",
      auth: state.auth,
      tier: surface.tier,
    });
    usageRow.render(surface.usageItems);
    actionRow.render(state.auth);
    tabs.render([
      { key: SIDEPANEL_TABS.CITATIONS, label: "Cites" },
      { key: SIDEPANEL_TABS.NOTES, label: "Notes" },
      { key: SIDEPANEL_TABS.DOCS, label: "Docs" },
      { key: SIDEPANEL_TABS.NEW_NOTE, label: "New Note" },
      { key: SIDEPANEL_TABS.QUOTES, label: "Quotes" },
    ], state.active_tab);
    setNotice();
    renderWorkspaceBody();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || !changes?.[STORAGE_KEYS.AUTH_STATE]) {
      return;
    }
    const auth = changes[STORAGE_KEYS.AUTH_STATE].newValue || { status: "signed_out" };
    stateStore.setAuth(auth);
    if (auth?.status === "signed_in") {
      createSignedInTabDefaults(stateStore);
      void ensureTabHydrated(stateStore.getState().active_tab, true);
    } else {
      stateStore.resetSignedOutTabs();
      render();
    }
  }

  chromeApi?.storage?.onChanged?.addListener?.(handleStorageChange);

  async function refresh() {
    const auth = await loadAuth();
    if (auth?.status === "signed_in") {
      createSignedInTabDefaults(stateStore);
      render();
      await ensureTabHydrated(stateStore.getState().active_tab, true);
    } else if (auth?.status === "signed_out") {
      stateStore.resetSignedOutTabs();
      render();
    } else {
      render();
    }
  }

  render();

  return {
    root: host,
    render,
    refresh,
    getState() {
      return stateStore.getState();
    },
    destroy() {
      chromeApi?.storage?.onChanged?.removeListener?.(handleStorageChange);
    },
  };
}

export function renderSidepanelShell(root, options: any = {}) {
  return createSidepanelShell({ root, ...options });
}
