// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { STORAGE_KEYS } from "../../shared/constants/storage_keys.js";
import { normalizeCapabilitySurface } from "../../shared/types/capability_surface.js";
import { createSidepanelClient } from "../messaging/client.js";
import { createNewNoteView } from "../new_note_view.js";
import { createCitationsListView, createNotesListView, createProfileCard, createSidepanelTabs, createStatusBanner, createUsageSummaryList, } from "../components/index.js";
import { createSidepanelStateStore, SIDEPANEL_STATUS, SIDEPANEL_TABS } from "./state.js";
function normalizeTabContext(tab = {}) {
    const pageUrl = typeof tab?.url === "string" ? tab.url.trim() : "";
    const pageTitle = typeof tab?.title === "string" ? tab.title.trim() : "";
    let pageDomain = "";
    try {
        pageDomain = pageUrl ? new URL(pageUrl).hostname.toLowerCase() : "";
    }
    catch { }
    return { pageTitle, pageUrl, pageDomain };
}
async function resolveActiveTabContext(chromeApi) {
    if (typeof chromeApi?.tabs?.query !== "function") {
        return null;
    }
    try {
        const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
        return normalizeTabContext(tabs?.[0] || null);
    }
    catch {
        return null;
    }
}
function describePageContext(pageContext) {
    if (!pageContext?.pageUrl) {
        return "Page context will be attached when available.";
    }
    return [pageContext.pageTitle || "Current page", pageContext.pageUrl].filter(Boolean).join(" • ");
}
function createShellStyles(documentRef) {
    const style = documentRef.createElement("style");
    style.textContent = `
    :host { display: block; }
    :host, :host * { box-sizing: border-box; }
    .writior-sidepanel-shell {
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 12px;
      min-height: 100vh;
      max-height: 100vh;
      padding: 16px;
      background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
      color: #0f172a;
      font-family: Georgia, "Times New Roman", serif;
    }
    .writior-sidepanel-top {
      display: grid;
      gap: 12px;
    }
    .writior-sidepanel-content {
      min-height: 0;
      overflow: auto;
      display: grid;
      align-content: start;
      gap: 12px;
      padding-bottom: 24px;
    }
  `;
    return style;
}
function renderSnapshotBody(snapshot) {
    const surface = normalizeCapabilitySurface({ auth: snapshot });
    const status = snapshot?.status || "signed_out";
    const usageText = surface.usageItems.length
        ? surface.usageItems.map((item) => `${item.label}: ${item.value}`).join(" • ")
        : "Usage updates appear here when available.";
    if (status === "loading") {
        return `
      <h1>Writior</h1>
      <p>Loading auth state</p>
    `;
    }
    if (status === "refreshing") {
        return `
      <h1>Writior</h1>
      <p>Refreshing session</p>
    `;
    }
    if (status === "error") {
        return `
      <h1>Writior</h1>
      <p>Auth error: ${snapshot?.error?.message || "unknown"}</p>
    `;
    }
    if (status === "signed_in") {
        const profileName = snapshot?.bootstrap?.profile?.display_name || snapshot?.session?.email || "Signed in";
        const destination = snapshot?.bootstrap?.app?.handoff?.preferred_destination || "Unavailable until bootstrap resolves";
        return `
      <h1>Writior</h1>
      <p>Signed in as ${profileName}</p>
      <p>Tier: ${surface.tier}</p>
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
    root.innerHTML = renderSnapshotBody(snapshot);
    return { mounted: true };
}
export function createSidepanelShell(options = {}) {
    const { root, documentRef = globalThis.document, chromeApi = globalThis.chrome, navigatorRef = globalThis.navigator, client = createSidepanelClient(chromeApi), } = options;
    if (!root) {
        throw new Error("createSidepanelShell requires a root element.");
    }
    const host = typeof root.attachShadow === "function" ? root.attachShadow({ mode: "open" }) : root;
    const style = createShellStyles(documentRef);
    const stateStore = createSidepanelStateStore();
    let removeStorageListener = null;
    const shell = documentRef.createElement("section");
    shell.className = "writior-sidepanel-shell";
    const top = documentRef.createElement("div");
    top.className = "writior-sidepanel-top";
    const content = documentRef.createElement("div");
    content.className = "writior-sidepanel-content";
    const profileCard = createProfileCard({
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
            render();
            const result = await client.authStart?.({
                trigger: "sidepanel_sign_in",
                redirectPath: "/dashboard",
            });
            if (result?.ok) {
                stateStore.setAuth(result.data?.auth || null);
                stateStore.setNotice({ tone: "info", message: "Signed in." });
                await refresh();
            }
            else {
                stateStore.setNotice({ tone: "error", message: result?.error?.message || "Sign in failed." });
                render();
            }
        },
        onSignOut: async () => {
            const result = await client.authLogout?.();
            if (result?.ok) {
                stateStore.setAuth(result.data?.auth || null);
                stateStore.setRecentCitations([]);
                stateStore.setRecentNotes([]);
                stateStore.setNotice({ tone: "info", message: "Signed out." });
            }
            else {
                stateStore.setNotice({ tone: "error", message: result?.error?.message || "Sign out failed." });
            }
            render();
        },
    });
    const usageSummary = createUsageSummaryList({ documentRef });
    const tabs = createSidepanelTabs({
        documentRef,
        tabs: [
            { key: SIDEPANEL_TABS.CITATIONS, label: "Citations" },
            { key: SIDEPANEL_TABS.NOTES, label: "Notes" },
            { key: SIDEPANEL_TABS.NEW_NOTE, label: "New Note" },
        ],
        activeTab: stateStore.getState().active_tab,
        onSelect: (activeTab) => {
            stateStore.setActiveTab(activeTab);
            render();
        },
    });
    const statusBanner = createStatusBanner({ documentRef });
    const citationsView = createCitationsListView({
        documentRef,
        onExpand: (citation) => {
            const current = stateStore.getState().expanded_citation_id;
            stateStore.setExpandedCitationId(current === citation.id ? null : citation.id);
            render();
        },
        onCopy: async ({ text }) => {
            try {
                await navigatorRef?.clipboard?.writeText?.(text || "");
                stateStore.setNotice({ tone: "info", message: "Citation copied." });
            }
            catch (error) {
                stateStore.setNotice({ tone: "error", message: error?.message || "Copy failed." });
            }
            render();
        },
    });
    const notesView = createNotesListView({
        documentRef,
        onExpand: (note) => {
            const current = stateStore.getState().expanded_note_id;
            stateStore.setExpandedNoteId(current === note.id ? null : note.id);
            render();
        },
        onCopy: async ({ text }) => {
            try {
                await navigatorRef?.clipboard?.writeText?.(text || "");
                stateStore.setNotice({ tone: "info", message: "Note copied." });
            }
            catch (error) {
                stateStore.setNotice({ tone: "error", message: error?.message || "Copy failed." });
            }
            render();
        },
    });
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
            stateStore.setState({ noteStatus: "closed", noteText: "", noteError: "" });
            render();
        },
        onInput: (value) => {
            stateStore.setState({ noteStatus: "editing", noteText: value, noteError: "" });
            render();
        },
        onSubmit: async () => {
            const state = stateStore.getState();
            const noteText = String(state.noteText || "").trim();
            if (!noteText) {
                stateStore.setState({ noteStatus: "error", noteError: "Note text is required." });
                render();
                return;
            }
            stateStore.setState({ noteStatus: "saving", noteError: "" });
            render();
            const payload = { noteText };
            if (state.pageContext?.pageTitle || state.pageContext?.pageUrl || state.pageContext?.pageDomain) {
                payload.capture = {
                    selectionText: "",
                    pageTitle: state.pageContext.pageTitle || "",
                    pageUrl: state.pageContext.pageUrl || "",
                    pageDomain: state.pageContext.pageDomain || "",
                };
            }
            const result = await client.createNote?.(payload);
            if (result?.ok) {
                stateStore.setState({ noteStatus: "success", noteText: "", noteError: "" });
                stateStore.setNotice({ tone: "info", message: "Note saved." });
                await loadRecentNotes();
            }
            else {
                stateStore.setState({ noteStatus: "error", noteError: result?.error?.message || "Save failed." });
                stateStore.setNotice({ tone: "error", message: result?.error?.message || "Save failed." });
            }
            render();
        },
    });
    async function loadAuth() {
        const result = await client.bootstrapFetch?.();
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
    async function loadRecentCitations() {
        const result = await client.listRecentCitations?.({ limit: 8 });
        if (result?.ok) {
            stateStore.setRecentCitations(result.data?.items || []);
            return;
        }
        stateStore.setNotice({ tone: "error", message: result?.error?.message || "Failed to load citations." });
    }
    async function loadRecentNotes() {
        const result = await client.listRecentNotes?.({ limit: 8 });
        if (result?.ok) {
            stateStore.setRecentNotes(result.data?.items || []);
            return;
        }
        stateStore.setNotice({ tone: "error", message: result?.error?.message || "Failed to load notes." });
    }
    async function refresh() {
        stateStore.setState({ status: SIDEPANEL_STATUS.LOADING });
        const auth = await loadAuth();
        if (auth?.status === "signed_in") {
            await Promise.all([loadRecentCitations(), loadRecentNotes()]);
        }
        else if (auth?.status === "signed_out") {
            stateStore.setRecentCitations([]);
            stateStore.setRecentNotes([]);
        }
        render();
    }
    function applyAuthSnapshot(auth, reason = "storage_update") {
        if (!auth) {
            return;
        }
        stateStore.setAuth(auth);
        if (auth.status === "signed_in") {
            void Promise.all([loadRecentCitations(), loadRecentNotes()]).finally(() => {
                stateStore.clearNotice();
                render();
            });
            return;
        }
        if (auth.status === "signed_out") {
            stateStore.setRecentCitations([]);
            stateStore.setRecentNotes([]);
            if (reason === "storage_update") {
                stateStore.setNotice({ tone: "info", message: "Signed out." });
            }
        }
        render();
    }
    function renderContent(state) {
        content.innerHTML = "";
        statusBanner.render(state.notice);
        if (state.notice?.message) {
            content.appendChild(statusBanner.root);
        }
        if (state.status === SIDEPANEL_STATUS.LOADING) {
            const loading = documentRef.createElement("section");
            loading.textContent = "Loading sidepanel state...";
            loading.style.color = "#475569";
            content.appendChild(loading);
            return;
        }
        if (state.status === SIDEPANEL_STATUS.SIGNED_OUT) {
            const signedOut = documentRef.createElement("section");
            signedOut.textContent = "Signed out";
            signedOut.style.color = "#475569";
            content.appendChild(signedOut);
            return;
        }
        if (state.status === SIDEPANEL_STATUS.ERROR) {
            const error = documentRef.createElement("section");
            error.textContent = state.notice?.message || "Unable to load sidepanel state.";
            error.style.color = "#991b1b";
            content.appendChild(error);
            return;
        }
        if (state.active_tab === SIDEPANEL_TABS.CITATIONS) {
            citationsView.render(state.recent_citations, state.expanded_citation_id);
            content.appendChild(citationsView.root);
            return;
        }
        if (state.active_tab === SIDEPANEL_TABS.NOTES) {
            notesView.render(state.recent_notes, state.expanded_note_id);
            content.appendChild(notesView.root);
            return;
        }
        newNoteView.render({
            status: state.noteStatus,
            noteText: state.noteText,
            errorMessage: state.noteError,
            pageContextText: describePageContext(state.pageContext),
        });
        content.appendChild(newNoteView.root);
    }
    function render() {
        const state = stateStore.getState();
        const surface = normalizeCapabilitySurface({ auth: state.auth });
        host.innerHTML = "";
        shell.innerHTML = "";
        top.innerHTML = "";
        profileCard.render(state.auth?.bootstrap?.profile || null, state.auth?.bootstrap?.entitlement || null, state.auth?.session?.email || "", state.auth);
        usageSummary.render(surface.usageItems);
        tabs.render([
            { key: SIDEPANEL_TABS.CITATIONS, label: "Citations" },
            { key: SIDEPANEL_TABS.NOTES, label: "Notes" },
            { key: SIDEPANEL_TABS.NEW_NOTE, label: "New Note" },
        ], state.active_tab);
        renderContent(state);
        top.appendChild(profileCard.root);
        top.appendChild(usageSummary.root);
        top.appendChild(tabs.root);
        shell.appendChild(style);
        shell.appendChild(top);
        shell.appendChild(content);
        host.appendChild(shell);
    }
    return {
        refresh,
        render,
        initialize() {
            if (typeof chromeApi?.storage?.onChanged?.addListener === "function") {
                const handleStorageChange = (changes, areaName) => {
                    if (areaName !== "local" || !changes?.[STORAGE_KEYS.AUTH_STATE]) {
                        return;
                    }
                    applyAuthSnapshot(changes[STORAGE_KEYS.AUTH_STATE].newValue || null);
                };
                chromeApi.storage.onChanged.addListener(handleStorageChange);
                removeStorageListener = () => chromeApi.storage.onChanged.removeListener?.(handleStorageChange);
            }
        },
        destroy() {
            removeStorageListener?.();
            removeStorageListener = null;
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
    shell.initialize?.();
    void shell.refresh();
    return shell;
}
