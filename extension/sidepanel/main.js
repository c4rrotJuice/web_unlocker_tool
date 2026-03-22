import { createLogger } from "../shared/utils/logger.js";
import { createRuntimeClient, SURFACE_NAMES } from "../shared/utils/runtime_client.js";
import { createNewNoteView } from "./new_note_view.js";
const logger = createLogger("sidepanel");
function createButton(documentRef, label, onClick) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.padding = "8px 12px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    button.style.background = "#ffffff";
    button.style.color = "#0f172a";
    button.addEventListener("click", onClick);
    return button;
}
function describeAuth(auth) {
    if (!auth) {
        return "Auth unavailable";
    }
    if (auth.status === "loading") {
        return "Loading auth state";
    }
    if (auth.status === "signed_out") {
        return "Signed out";
    }
    if (auth.status === "signed_in") {
        const name = auth.bootstrap?.profile?.display_name || auth.session?.email || "Signed in";
        return `${name}`;
    }
    return auth.error?.message || "Authentication failed";
}
function getAuthStatusText(result) {
    const typedResult = result;
    return typedResult.ok ? describeAuth(typedResult.data?.auth) : typedResult.error.message;
}
function normalizeTabContext(tab = {}) {
    const pageUrl = typeof tab?.url === "string" ? tab.url.trim() : "";
    const pageTitle = typeof tab?.title === "string" ? tab.title.trim() : "";
    let pageDomain = "";
    try {
        pageDomain = pageUrl ? new URL(pageUrl).hostname.toLowerCase() : "";
    }
    catch { }
    return {
        pageTitle,
        pageUrl,
        pageDomain,
    };
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
export function renderSidepanel(root, options = {}) {
    const typedOptions = options;
    const documentRef = typedOptions.documentRef || globalThis.document;
    const chromeApi = typedOptions.chromeApi || globalThis.chrome;
    const runtimeClient = typedOptions.runtimeClient || createRuntimeClient(chromeApi, SURFACE_NAMES.SIDEPANEL);
    const setTimeoutRef = typedOptions.setTimeoutRef || globalThis.setTimeout?.bind(globalThis);
    const clearTimeoutRef = typedOptions.clearTimeoutRef || globalThis.clearTimeout?.bind(globalThis);
    const shell = documentRef.createElement("section");
    const header = documentRef.createElement("div");
    const title = documentRef.createElement("h1");
    const subtitle = documentRef.createElement("p");
    const authStatus = documentRef.createElement("p");
    const authActions = documentRef.createElement("div");
    shell.style.display = "grid";
    shell.style.gap = "16px";
    shell.style.padding = "16px";
    shell.style.fontFamily = "Georgia, 'Times New Roman', serif";
    shell.style.color = "#0f172a";
    shell.style.background = "#f8fafc";
    header.style.display = "grid";
    header.style.gap = "6px";
    title.textContent = "Writior Sidepanel";
    title.style.margin = "0";
    title.style.fontSize = "20px";
    subtitle.textContent = "Capture plain notes without keeping local note truth.";
    subtitle.style.margin = "0";
    subtitle.style.fontSize = "13px";
    subtitle.style.lineHeight = "1.45";
    subtitle.style.color = "#475569";
    authStatus.textContent = "Loading auth state";
    authStatus.style.margin = "0";
    authStatus.style.fontSize = "13px";
    authStatus.style.color = "#334155";
    authActions.style.display = "flex";
    authActions.style.flexWrap = "wrap";
    authActions.style.gap = "8px";
    const state = {
        noteStatus: "closed",
        noteText: "",
        noteError: "",
        pageContext: null,
    };
    let successTimer = null;
    const noteView = createNewNoteView({
        documentRef,
        onOpen: async () => {
            state.pageContext = await resolveActiveTabContext(chromeApi);
            state.noteStatus = "editing";
            state.noteError = "";
            renderNoteView();
            noteView.focusInput();
        },
        onCancel: () => {
            if (successTimer && clearTimeoutRef) {
                clearTimeoutRef(successTimer);
                successTimer = null;
            }
            state.noteStatus = "closed";
            state.noteText = "";
            state.noteError = "";
            renderNoteView();
        },
        onInput: (value) => {
            state.noteText = value;
            state.noteStatus = "editing";
            state.noteError = "";
            renderNoteView();
        },
        onSubmit: async () => {
            const noteText = String(state.noteText || "").trim();
            if (!noteText) {
                state.noteStatus = "error";
                state.noteError = "Note text is required.";
                renderNoteView();
                return;
            }
            state.noteStatus = "saving";
            state.noteError = "";
            renderNoteView();
            const payload = { noteText };
            if (state.pageContext?.pageTitle || state.pageContext?.pageUrl || state.pageContext?.pageDomain) {
                payload.capture = {
                    selectionText: "",
                    pageTitle: state.pageContext.pageTitle || "",
                    pageUrl: state.pageContext.pageUrl || "",
                    pageDomain: state.pageContext.pageDomain || "",
                };
            }
            const result = await runtimeClient.createNote(payload);
            if (result?.ok) {
                state.noteStatus = "success";
                state.noteText = "";
                state.noteError = "";
                renderNoteView();
                if (successTimer && clearTimeoutRef) {
                    clearTimeoutRef(successTimer);
                }
                successTimer = setTimeoutRef?.(() => {
                    successTimer = null;
                    state.noteStatus = "closed";
                    renderNoteView();
                }, 900) || null;
                return;
            }
            state.noteStatus = "error";
            state.noteError = result?.error?.message || "Save failed.";
            renderNoteView();
        },
    });
    function renderNoteView() {
        noteView.render({
            status: state.noteStatus,
            noteText: state.noteText,
            errorMessage: state.noteError,
            pageContextText: describePageContext(state.pageContext),
        });
    }
    async function refreshAuth() {
        const result = await runtimeClient.authStatusGet();
        authStatus.textContent = getAuthStatusText(result);
        return result;
    }
    authActions.append(createButton(documentRef, "Sign in", async () => {
        authStatus.textContent = "Starting sign-in";
        const result = await runtimeClient.authStart({
            trigger: "sidepanel_sign_in",
            redirectPath: "/dashboard",
        });
        authStatus.textContent = getAuthStatusText(result);
    }), createButton(documentRef, "Refresh auth", async () => {
        authStatus.textContent = "Refreshing auth";
        await refreshAuth();
    }), createButton(documentRef, "Sign out", async () => {
        const result = await runtimeClient.authLogout();
        authStatus.textContent = getAuthStatusText(result);
    }));
    header.append(title, subtitle, authStatus);
    shell.append(header, authActions, noteView.root);
    if (typeof root.replaceChildren === "function") {
        root.replaceChildren(shell);
    }
    else {
        root.innerHTML = "";
        root.appendChild(shell);
    }
    renderNoteView();
    void refreshAuth();
    return {
        shell,
        noteView,
        getState() {
            return {
                noteStatus: state.noteStatus,
                noteText: state.noteText,
                noteError: state.noteError,
                pageContext: state.pageContext,
            };
        },
    };
}
export function bootstrapSidepanel() {
    logger.info("sidepanel loaded");
    const root = document.getElementById("app");
    if (!root) {
        return null;
    }
    return renderSidepanel(root);
}
if (typeof globalThis.document !== "undefined") {
    bootstrapSidepanel();
}
