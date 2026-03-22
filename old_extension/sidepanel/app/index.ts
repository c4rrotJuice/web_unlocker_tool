import { MESSAGE_NAMES } from "../../shared/constants/message_names.ts";
import { AUTH_STATUS } from "../../shared/types/auth.ts";
import { buildWorkInEditorPayload } from "../../shared/types/work_in_editor.ts";
import { normalizeCapabilitySurface } from "../../shared/types/capability_surface.ts";
import { createSidepanelStateStore, SIDEPANEL_STATUS, SIDEPANEL_TAB_KEYS } from "./state.ts";
import { renderCitationModal } from "./citation_modal.ts";
import { renderAuthView, renderCitationView, renderNoteView, renderStatusView } from "../views/index.ts";
import { createSidepanelTabs, createProfileCard, createUsageSummaryList } from "../components/index.ts";

function renderBody(snapshot) {
  const status = snapshot?.status || AUTH_STATUS.SIGNED_OUT;
  const surface = normalizeCapabilitySurface({ auth: snapshot });
  const usageText = surface.usageItems.length
    ? surface.usageItems.map((item) => `${item.label}: ${item.value}`).join(" • ")
    : `Tier: ${surface.tier}`;
  if (status === AUTH_STATUS.LOADING) {
    return `
      <h1>Writior</h1>
      <p>Loading auth state</p>
    `;
  }
  if (status === AUTH_STATUS.ERROR) {
    return `
      <h1>Writior</h1>
      <p>Auth error: ${snapshot?.error?.message || "unknown"}</p>
    `;
  }
  if (status === AUTH_STATUS.SIGNED_IN) {
    const profileName = snapshot?.bootstrap?.profile?.display_name || snapshot?.session?.email || "Signed in";
    const tier = surface.tier || "unknown";
    const destination = snapshot?.bootstrap?.app?.handoff?.preferred_destination || "/editor";
    return `
      <h1>Writior</h1>
      <p>Signed in as ${profileName}</p>
      <p>Tier: ${tier}</p>
      <p>Preferred destination: ${destination}</p>
      <p>${usageText}</p>
    `;
  }
  return `
    <h1>Writior</h1>
    <p>Signed out</p>
    <p>Tier: ${surface.tier}</p>
    <p>${usageText}</p>
  `;
}

export function renderSidepanelAuthSnapshot(root, snapshot) {
  if (!root) {
    return { mounted: false };
  }
  root.innerHTML = "";
  root.innerHTML = renderBody(snapshot);
  return { mounted: true };
}

export function renderSidepanelCitationSnapshot(root, snapshot, options = {}) {
  return renderCitationModal(root, snapshot, options);
}

function createShellStyles(documentRef) {
  const style = documentRef.createElement("style");
  style.textContent = `
    :host {
      display: block;
      color: #e2e8f0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    :host *, :host *::before, :host *::after {
      box-sizing: border-box;
    }
    .writior-shell {
      display: grid;
      grid-template-rows: auto auto 1fr;
      gap: 12px;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 16px;
      background: linear-gradient(180deg, rgba(2, 6, 23, 0.98), rgba(15, 23, 42, 0.96));
    }
    .writior-shell__top {
      display: grid;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 2;
      padding-bottom: 2px;
      background: linear-gradient(180deg, rgba(2, 6, 23, 0.98), rgba(2, 6, 23, 0.88));
      backdrop-filter: blur(12px);
    }
    .writior-shell__content {
      overflow: auto;
      display: grid;
      align-content: start;
      gap: 12px;
      padding-bottom: 24px;
    }
    .writior-shell__pane {
      display: grid;
      gap: 12px;
      align-content: start;
    }
    .writior-shell__empty {
      color: #94a3b8;
    }
    [data-profile-card="true"],
    [data-status-view="true"],
    [data-usage-summary-list="true"],
    [data-hover-preview="true"],
    [data-citation-preview-card="true"],
    [data-citations-list-view="true"] section,
    [data-notes-list-view="true"] section,
    [data-new-note-view="true"],
    [data-sidepanel-tabs="true"] button,
    [data-citation-style-tabs="true"] button,
    [data-citation-format-tabs="true"] button,
    [data-selection-menu="true"] button,
    [data-tier-badge="true"] {
      transition: transform 140ms ease, border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
    }
    [data-citations-list-view="true"] section:hover,
    [data-notes-list-view="true"] section:hover,
    [data-profile-card="true"] button:hover,
    [data-status-view="true"] button:hover,
    [data-sidepanel-tabs="true"] button:hover,
    [data-citation-style-tabs="true"] button:hover,
    [data-citation-format-tabs="true"] button:hover,
    [data-selection-menu="true"] button:hover,
    [data-new-note-view="true"] button:hover {
      transform: translateY(-1px);
    }
    [data-citations-list-view="true"] section:focus-visible,
    [data-notes-list-view="true"] section:focus-visible,
    [data-profile-card="true"] button:focus-visible,
    [data-sidepanel-tabs="true"] button:focus-visible,
    [data-citation-style-tabs="true"] button:focus-visible,
    [data-citation-format-tabs="true"] button:focus-visible,
    [data-selection-menu="true"] button:focus-visible,
    [data-new-note-view="true"] input:focus-visible,
    [data-new-note-view="true"] textarea:focus-visible,
    [data-new-note-view="true"] button:focus-visible {
      outline: 2px solid rgba(96, 165, 250, 0.75);
      outline-offset: 2px;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }
    @media (prefers-reduced-motion: reduce) {
      :host *, :host *::before, :host *::after {
        transition: none !important;
        animation: none !important;
        scroll-behavior: auto !important;
      }
      [data-citations-list-view="true"] section:hover,
      [data-notes-list-view="true"] section:hover,
      [data-profile-card="true"] button:hover,
      [data-sidepanel-tabs="true"] button:hover,
      [data-citation-style-tabs="true"] button:hover,
      [data-citation-format-tabs="true"] button:hover,
      [data-selection-menu="true"] button:hover,
      [data-new-note-view="true"] button:hover {
        transform: none !important;
      }
    }
  `;
  return style;
}

function buildEntityWorkPayload(entity, text, { source = "sidepanel", noteText = "" } = {}) {
  const pageUrl = entity?.source?.url
    || entity?.page_url
    || entity?.pageUrl
    || entity?.metadata?.canonical_url
    || entity?.source?.canonical_url
    || "";
  const pageTitle = entity?.source?.title || entity?.title || entity?.metadata?.title || "";
  const pageDomain = entity?.source?.hostname || entity?.source?.host || entity?.pageDomain || "";
  return buildWorkInEditorPayload({
    selectionText: text || "",
    pageTitle,
    pageUrl,
    pageDomain,
    metadata: entity?.metadata || {},
    noteText: noteText || "",
    commentaryText: noteText || "",
    entity,
    source,
  });
}

export function createSidepanelShell({
  root,
  documentRef = globalThis.document,
  navigatorRef = globalThis.navigator,
  chromeApi = globalThis.chrome,
  client,
} = {}) {
  if (!root) {
    throw new Error("createSidepanelShell requires a root element.");
  }

  const host = typeof root.attachShadow === "function" ? root.attachShadow({ mode: "open" }) : root;
  const stateStore = createSidepanelStateStore();
  const shellRoot = documentRef.createElement("section");
  shellRoot.className = "writior-shell";
  const top = documentRef.createElement("div");
  top.className = "writior-shell__top";
  const content = documentRef.createElement("div");
  content.className = "writior-shell__content";
  const pane = documentRef.createElement("div");
  pane.className = "writior-shell__pane";
  const style = createShellStyles(documentRef);

  const tabs = createSidepanelTabs({
    documentRef,
    tabs: [
      { key: SIDEPANEL_TAB_KEYS.CITATIONS, label: "Citations" },
      { key: SIDEPANEL_TAB_KEYS.NOTES, label: "Notes" },
      { key: SIDEPANEL_TAB_KEYS.NEW_NOTE, label: "New Note" },
    ],
    activeTab: stateStore.getState().active_tab,
    onSelect: (activeTab) => {
      stateStore.setActiveTab(activeTab);
      render();
    },
  });

  const profileCard = createProfileCard({
    documentRef,
    onOpenEditor: async () => {
      await client?.openEditor?.();
    },
    onOpenDashboard: async () => {
      await client?.openDashboard?.();
    },
    onSignOut: async () => {
      await client?.signOut?.();
      stateStore.setAuth({ status: AUTH_STATUS.SIGNED_OUT, reason: "signed_out", session: null, bootstrap: null, error: null });
      stateStore.setRecentCitations([]);
      stateStore.setRecentNotes([]);
      render();
    },
  });

  const usageSummary = createUsageSummaryList({ documentRef, items: [] });
  const authPane = documentRef.createElement("div");
  const citationsPane = documentRef.createElement("div");
  const notesPane = documentRef.createElement("div");
  const statusPane = documentRef.createElement("div");
  const noticePane = documentRef.createElement("div");

  async function loadAuth() {
    stateStore.setLoading({ auth: true });
    const response = await client.restoreSession?.();
    const authResponse = response?.ok ? response : await client.getAuthState();
    if (!authResponse || authResponse.ok === false) {
      stateStore.setError(authResponse?.error || { code: "auth_error", message: "Failed to load auth state." });
      return;
    }
    const auth = authResponse.data?.auth || authResponse.data || null;
    if (!auth) {
      stateStore.setError({ code: "auth_error", message: "Failed to load auth state." });
      return;
    }
    stateStore.setAuth(auth);
    stateStore.setBootstrap(auth?.bootstrap || null);
    return;
  }

  async function loadRecentCitations() {
    const response = await client.listCitations({ limit: 8 });
    if (!response || response.ok === false) {
      stateStore.setError(response?.error || { code: "network_error", message: "Failed to load citations." });
      return;
    }
    stateStore.setRecentCitations(Array.isArray(response.data) ? response.data : response.data?.items || []);
  }

  async function loadRecentNotes() {
    const response = await client.listNotes({ limit: 8 });
    if (!response || response.ok === false) {
      stateStore.setError(response?.error || { code: "network_error", message: "Failed to load notes." });
      return;
    }
    stateStore.setRecentNotes(Array.isArray(response.data) ? response.data : response.data?.items || []);
  }

  async function refresh() {
    await loadAuth();
    const state = stateStore.getState();
    if (state.status === SIDEPANEL_STATUS.READY || state.auth?.status === AUTH_STATUS.SIGNED_IN) {
      await Promise.all([loadRecentCitations(), loadRecentNotes()]);
    }
    render();
  }

  function renderHeader(state) {
    const surface = normalizeCapabilitySurface({ auth: state.auth, bootstrap: state.bootstrap || state.auth?.bootstrap || null });
    profileCard.render(
      state.auth?.bootstrap?.profile || null,
      state.auth?.bootstrap?.entitlement || null,
      state.bootstrap || state.auth?.bootstrap || null,
    );
    usageSummary.render(surface.usageItems);
    tabs.render([
      { key: SIDEPANEL_TAB_KEYS.CITATIONS, label: "Citations" },
      { key: SIDEPANEL_TAB_KEYS.NOTES, label: "Notes" },
      { key: SIDEPANEL_TAB_KEYS.NEW_NOTE, label: "New Note" },
    ], state.active_tab);
  }

  function renderContent(state) {
    pane.innerHTML = "";
    if (state.status === SIDEPANEL_STATUS.LOADING) {
      const loading = renderStatusView(statusPane, { title: "Loading", message: "Fetching background state…" }, { documentRef });
      pane.appendChild(statusPane);
      return;
    }
    if (state.status === SIDEPANEL_STATUS.ERROR) {
      const error = renderStatusView(statusPane, { status: "error", title: "Error", message: state.error?.message || "Something went wrong." }, { documentRef });
      pane.appendChild(statusPane);
      return;
    }
    if (state.status === SIDEPANEL_STATUS.SIGNED_OUT || state.auth?.status === AUTH_STATUS.SIGNED_OUT) {
      const signedOut = renderAuthView(authPane, { status: AUTH_STATUS.SIGNED_OUT, auth: state.auth, bootstrap: state.bootstrap }, { documentRef });
      pane.appendChild(authPane);
      return;
    }

    if (state.active_tab === SIDEPANEL_TAB_KEYS.CITATIONS) {
      const surface = normalizeCapabilitySurface({ auth: state.auth, bootstrap: state.bootstrap || state.auth?.bootstrap || null });
      renderCitationView(citationsPane, {
        recent_citations: state.recent_citations,
        expanded_citation_id: state.expanded_citation_id,
        locked_styles: surface.lockedStyles,
        action_availability: surface.actionAvailability,
      }, {
        documentRef,
        chromeApi,
        navigatorRef,
        onExpandCitation: (citation) => {
          stateStore.setExpandedCitationId(state.expanded_citation_id === citation.id ? null : citation.id);
          render();
        },
        onCopyCitation: async ({ text }) => {
          try {
            await navigatorRef?.clipboard?.writeText?.(text || "");
            stateStore.setNotice({ tone: "info", message: "Citation copied." });
            render();
          } catch (error) {
            stateStore.setError({ code: "copy_failed", message: error?.message || "Copy failed." });
            render();
          }
        },
        onSaveCitation: async ({ citation, text }) => {
          await client.saveCitationState({
            citation_id: citation?.id,
            style: citation?.style || "apa",
            format: citation?.format || "bibliography",
            text,
          });
        },
        onRequestRenderCitation: async (payload) => client.renderCitation(payload),
        onDismissCitation: () => {
          stateStore.setExpandedCitationId(null);
          render();
        },
        onWorkInEditorCitation: async ({ citation, text }) => {
          const response = await client.workInEditor(buildEntityWorkPayload(citation, text));
          if (response?.ok) {
            stateStore.setNotice({ tone: "info", message: "Opened editor from citation." });
          } else {
            stateStore.setError(response?.error || { code: "editor_open_failed", message: "Failed to open editor." });
          }
          render();
        },
      });
      pane.appendChild(citationsPane);
      return;
    }

    if (state.active_tab === SIDEPANEL_TAB_KEYS.NOTES) {
      const surface = normalizeCapabilitySurface({ auth: state.auth, bootstrap: state.bootstrap || state.auth?.bootstrap || null });
      renderNoteView(notesPane, {
        recent_notes: state.recent_notes,
        expanded_note_id: state.expanded_note_id,
        draft_note: state.draft_note,
        active_tab: state.active_tab,
        action_availability: surface.actionAvailability,
      }, {
        documentRef,
        onExpandNote: (note) => {
          stateStore.setExpandedNoteId(state.expanded_note_id === note.id ? null : note.id);
          render();
        },
        onCopyNote: async ({ text }) => {
          try {
            await navigatorRef?.clipboard?.writeText?.(text || "");
            stateStore.setNotice({ tone: "info", message: "Note copied." });
            render();
          } catch (error) {
            stateStore.setError({ code: "copy_failed", message: error?.message || "Copy failed." });
            render();
          }
        },
        onChangeDraft: (draft_note) => {
          stateStore.setDraftNote(draft_note);
        },
        onSubmitNote: async (draft) => {
          const response = await client.createNote({
            title: draft.title,
            note_body: draft.body,
          });
          if (response?.ok) {
            stateStore.setDraftNote({ title: "", body: "" });
            await loadRecentNotes();
          } else {
            stateStore.setError(response?.error || { code: "note_create_failed", message: "Failed to create note." });
          }
          render();
        },
        onWorkInEditorNote: async ({ note, text }) => {
          const response = await client.workInEditor(buildEntityWorkPayload(note, text));
          if (response?.ok) {
            stateStore.setNotice({ tone: "info", message: "Opened editor from note." });
          } else {
            stateStore.setError(response?.error || { code: "editor_open_failed", message: "Failed to open editor." });
          }
          render();
        },
        onWorkInEditorDraft: async (draft) => {
          const response = await client.workInEditor(buildWorkInEditorPayload({
            selectionText: draft.body || draft.title || "",
            pageTitle: draft.title || "",
            noteText: draft.body || "",
            commentaryText: draft.body || "",
            source: "sidepanel",
          }));
          if (response?.ok) {
            stateStore.setNotice({ tone: "info", message: "Opened editor from draft note." });
          } else {
            stateStore.setError(response?.error || { code: "editor_open_failed", message: "Failed to open editor." });
          }
          render();
        },
      });
      pane.appendChild(notesPane);
      return;
    }

    renderNoteView(notesPane, {
      recent_notes: state.recent_notes,
      expanded_note_id: state.expanded_note_id,
      draft_note: state.draft_note,
      active_tab: SIDEPANEL_TAB_KEYS.NEW_NOTE,
      action_availability: normalizeCapabilitySurface({ auth: state.auth, bootstrap: state.bootstrap || state.auth?.bootstrap || null }).actionAvailability,
    }, {
      documentRef,
      onExpandNote: (note) => {
        stateStore.setExpandedNoteId(state.expanded_note_id === note.id ? null : note.id);
        render();
      },
      onCopyNote: async ({ text }) => {
        await navigatorRef?.clipboard?.writeText?.(text || "");
      },
      onChangeDraft: (draft_note) => {
        stateStore.setDraftNote(draft_note);
      },
      onSubmitNote: async (draft) => {
        const response = await client.createNote({
          title: draft.title,
          note_body: draft.body,
        });
        if (response?.ok) {
          stateStore.setDraftNote({ title: "", body: "" });
          await loadRecentNotes();
        } else {
          stateStore.setError(response?.error || { code: "note_create_failed", message: "Failed to create note." });
        }
        render();
      },
      onWorkInEditorNote: async ({ note, text }) => {
        const response = await client.workInEditor(buildEntityWorkPayload(note, text));
        if (response?.ok) {
          stateStore.setNotice({ tone: "info", message: "Opened editor from note." });
        } else {
          stateStore.setError(response?.error || { code: "editor_open_failed", message: "Failed to open editor." });
        }
        render();
      },
      onWorkInEditorDraft: async (draft) => {
        const response = await client.workInEditor(buildWorkInEditorPayload({
          selectionText: draft.body || draft.title || "",
          pageTitle: draft.title || "",
          noteText: draft.body || "",
          commentaryText: draft.body || "",
          source: "sidepanel",
        }));
        if (response?.ok) {
          stateStore.setNotice({ tone: "info", message: "Opened editor from draft note." });
        } else {
          stateStore.setError(response?.error || { code: "editor_open_failed", message: "Failed to open editor." });
        }
        render();
      },
    });
    pane.appendChild(notesPane);
  }

  function render() {
    const state = stateStore.getState();
    host.innerHTML = "";
    shellRoot.innerHTML = "";
    shellRoot.appendChild(style);
    top.innerHTML = "";
    content.innerHTML = "";
    renderHeader(state);
    renderContent(state);
    shellRoot.appendChild(top);
    shellRoot.appendChild(content);
    top.appendChild(profileCard.root);
    top.appendChild(usageSummary.root);
    top.appendChild(tabs.root);
    if (state.notice) {
      renderStatusView(noticePane, { title: "Status", message: state.notice.message, tone: state.notice.tone || "neutral" }, { documentRef });
      content.appendChild(noticePane);
    }
    content.appendChild(pane);
    host.appendChild(shellRoot);
  }

  return {
    stateStore,
    refresh,
    render,
    destroy() {
      host.innerHTML = "";
    },
    getState() {
      return stateStore.getState();
    },
  };
}

export function renderSidepanelShell(root, options = {}) {
  const shell = createSidepanelShell({ root, ...options });
  shell.render();
  void shell.refresh();
  return shell;
}

export { renderAuthView, renderCitationView, renderNoteView, renderStatusView };
