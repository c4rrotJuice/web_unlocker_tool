import { buildSelectionContextPayload } from "./context.js";
import { extractNormalizedSelection, selectionSignature } from "./extraction.js";
import { extractPageMetadata } from "./page_metadata.js";
import { createSelectionActionPill } from "../ui/selection_action_pill.js";
import { createQuickNotePanel } from "../ui/quick_note_panel.js";
import { createContentToastController } from "../ui/toast.js";
import { SURFACE_NAMES } from "../../shared/types/contracts.js";
import { createRuntimeClient } from "../../shared/utils/runtime_client.js";
function isCommandShortcut(event) {
    return Boolean(event?.shiftKey && (event?.ctrlKey || event?.metaKey));
}
function describeCaptureFailure(result) {
    const code = result?.error?.code || "";
    if (code === "invalid_context") {
        return "Extension updated. Reload page.";
    }
    if (code === "unauthorized" || code === "auth_invalid") {
        return "Sign in required";
    }
    return result?.error?.message || "Save failed";
}
async function copyTextToClipboard(text, { navigatorRef, documentRef }) {
    const value = String(text || "");
    try {
        if (navigatorRef?.clipboard?.writeText) {
            await navigatorRef.clipboard.writeText(value);
            return { ok: true, method: "clipboard" };
        }
    }
    catch { }
    try {
        if (typeof documentRef?.execCommand === "function") {
            const body = documentRef?.body || documentRef?.documentElement;
            const activeElement = documentRef?.activeElement || null;
            const textarea = typeof documentRef?.createElement === "function"
                ? documentRef.createElement("textarea")
                : null;
            if (body && textarea) {
                const handleCopy = (event) => {
                    event?.stopImmediatePropagation?.();
                    event?.preventDefault?.();
                    event?.clipboardData?.setData?.("text/plain", value);
                };
                textarea.value = value;
                textarea.setAttribute("readonly", "true");
                textarea.setAttribute("aria-hidden", "true");
                textarea.style.position = "fixed";
                textarea.style.top = "0";
                textarea.style.left = "-9999px";
                textarea.style.opacity = "0";
                body.appendChild(textarea);
                textarea.focus?.();
                textarea.select?.();
                documentRef?.addEventListener?.("copy", handleCopy, true);
                const ok = documentRef.execCommand("copy");
                documentRef?.removeEventListener?.("copy", handleCopy, true);
                textarea.remove?.();
                activeElement?.focus?.();
                if (ok) {
                    return { ok: true, method: "execCommand" };
                }
            }
        }
    }
    catch { }
    return { ok: false, method: "none" };
}
export function createSelectionRuntime({ documentRef = globalThis.document, windowRef = globalThis.window, MutationObserverRef = globalThis.MutationObserver, navigatorRef = globalThis.navigator, chromeApi = globalThis.chrome, runtimeClientFactory = createRuntimeClient, setTimeoutRef = globalThis.setTimeout?.bind(globalThis), clearTimeoutRef = globalThis.clearTimeout?.bind(globalThis), minimumLength = 3, } = {}) {
    const toast = createContentToastController({ documentRef, windowRef });
    const runtimeClient = chromeApi?.runtime?.sendMessage
        ? runtimeClientFactory(chromeApi, SURFACE_NAMES.CONTENT)
        : null;
    const state = {
        enabled: false,
        isPointerSelecting: false,
        visible: false,
        inspectCount: 0,
        renderCount: 0,
        dismissCount: 0,
        lastDismissReason: "",
        pendingAction: "",
        currentSnapshot: null,
        currentSignature: "",
        noteStatus: "closed",
        noteText: "",
        noteError: "",
    };
    const listeners = [];
    const pill = createSelectionActionPill({
        documentRef,
        windowRef,
        onAction: async (action) => {
            await runAction(action);
        },
        onDismiss: (reason) => {
            state.lastDismissReason = reason;
        },
    });
    const quickNotePanel = createQuickNotePanel({
        documentRef,
        windowRef,
        onInput: (value) => {
            state.noteText = value;
            state.noteStatus = "editing";
            state.noteError = "";
            renderQuickNotePanel();
        },
        onCancel: () => {
            closeQuickNotePanel("cancel");
        },
        onSave: async () => {
            await saveQuickNote();
        },
    });
    let observer = null;
    let inspectTimer = null;
    let noteSuccessTimer = null;
    function addListener(target, type, handler, options = true) {
        if (!target?.addEventListener) {
            return;
        }
        target.addEventListener(type, handler, options);
        listeners.push(() => target.removeEventListener?.(type, handler, options));
    }
    function buildSelectionActions() {
        return [
            { key: "copy", label: "Copy", active: true, locked: false },
            { key: "cite", label: "Cite", active: Boolean(runtimeClient), locked: false },
            { key: "quote", label: "Quote", active: Boolean(runtimeClient), locked: false },
            { key: "note", label: "Note", active: Boolean(runtimeClient), locked: false },
        ];
    }
    function hide(reason = "dismiss") {
        const wasVisible = state.visible;
        state.visible = false;
        state.currentSnapshot = null;
        state.currentSignature = "";
        state.pendingAction = "";
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        state.noteStatus = "closed";
        state.noteText = "";
        state.noteError = "";
        quickNotePanel.hide();
        if (wasVisible) {
            state.dismissCount += 1;
        }
        pill.hide(reason);
    }
    function show(snapshot) {
        const signature = selectionSignature(snapshot?.selection);
        state.visible = true;
        state.currentSnapshot = snapshot;
        if (!state.currentSignature) {
            state.renderCount += 1;
        }
        state.currentSignature = signature;
        pill.render({
            ...snapshot,
            actions: buildSelectionActions(),
        });
    }
    function inspectSelection() {
        if (quickNotePanel.isVisible() && state.currentSnapshot) {
            renderQuickNotePanel();
            return state.currentSnapshot;
        }
        state.inspectCount += 1;
        const selection = extractNormalizedSelection({ documentRef, minimumLength });
        if (!selection) {
            hide("selection_invalid");
            return null;
        }
        const signature = selectionSignature(selection);
        const page = extractPageMetadata({ documentRef, windowRef });
        const snapshot = {
            selection,
            page,
            ui: {
                pill: true,
                status: "copy_only",
            },
            payload: buildSelectionContextPayload({ selection, page }),
        };
        if (state.currentSignature === signature && state.visible) {
            state.currentSnapshot = snapshot;
            pill.render({
                ...snapshot,
                actions: buildSelectionActions(),
            });
            return state.currentSnapshot;
        }
        show(snapshot);
        return state.currentSnapshot;
    }
    function scheduleInspect(delay = 30) {
        if (state.isPointerSelecting) {
            return;
        }
        if (inspectTimer) {
            return;
        }
        inspectTimer = setTimeoutRef?.(() => {
            inspectTimer = null;
            inspectSelection();
        }, delay) || null;
    }
    function renderQuickNotePanel() {
        if (!state.currentSnapshot) {
            return;
        }
        const capture = state.currentSnapshot.payload?.capture || {};
        quickNotePanel.render({
            selectionText: capture.selectionText,
            pageTitle: capture.pageTitle,
            pageUrl: capture.pageUrl,
            selectionRect: state.currentSnapshot.selection?.rect || null,
            noteText: state.noteText,
            status: state.noteStatus,
            errorMessage: state.noteError,
        });
    }
    function openQuickNotePanel() {
        if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
            pill.flash("Failed");
            toast.show("Capture unavailable");
            return { ok: false, error: { code: "capture_unavailable" } };
        }
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        state.noteStatus = "editing";
        state.noteText = "";
        state.noteError = "";
        pill.hide("note_open");
        quickNotePanel.show({
            selectionText: state.currentSnapshot.payload.capture.selectionText,
            pageTitle: state.currentSnapshot.payload.capture.pageTitle,
            pageUrl: state.currentSnapshot.payload.capture.pageUrl,
            selectionRect: state.currentSnapshot.selection?.rect || null,
            noteText: state.noteText,
            status: state.noteStatus,
            errorMessage: state.noteError,
        });
        quickNotePanel.focusInput();
        return { ok: true };
    }
    function closeQuickNotePanel(reason = "note_closed") {
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        state.noteStatus = "closed";
        state.noteText = "";
        state.noteError = "";
        quickNotePanel.hide();
        if (state.currentSnapshot) {
            pill.render({
                ...state.currentSnapshot,
                actions: buildSelectionActions(),
            });
            state.visible = true;
        }
        else {
            pill.hide(reason);
        }
    }
    async function saveQuickNote() {
        if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
            state.noteStatus = "error";
            state.noteError = "Capture unavailable";
            renderQuickNotePanel();
            return { ok: false, error: { code: "capture_unavailable" } };
        }
        if (state.pendingAction) {
            return { ok: false, error: { code: "capture_pending" } };
        }
        const noteText = String(state.noteText || "").trim();
        if (!noteText) {
            state.noteStatus = "error";
            state.noteError = "Note text is required.";
            renderQuickNotePanel();
            return { ok: false, error: { code: "invalid_note_text" } };
        }
        state.pendingAction = "note";
        state.noteStatus = "saving";
        state.noteError = "";
        renderQuickNotePanel();
        try {
            const result = await runtimeClient.createNote({
                ...state.currentSnapshot.payload,
                noteText,
            });
            if (result?.ok) {
                state.noteStatus = "success";
                state.noteError = "";
                renderQuickNotePanel();
                toast.show("Note saved");
                noteSuccessTimer = setTimeoutRef?.(() => {
                    noteSuccessTimer = null;
                    closeQuickNotePanel("note_saved");
                    hide("note_saved");
                }, 900) || null;
                return result;
            }
            state.noteStatus = "error";
            state.noteError = describeCaptureFailure(result);
            renderQuickNotePanel();
            toast.show(state.noteError);
            return result;
        }
        finally {
            state.pendingAction = "";
        }
    }
    async function runAction(action) {
        if (action === "copy") {
            if (!state.currentSnapshot?.selection?.text) {
                return { ok: false, error: { code: "invalid_selection" } };
            }
            const result = await copyTextToClipboard(state.currentSnapshot.selection.text, { navigatorRef, documentRef });
            if (result.ok) {
                pill.setCopySuccess();
                toast.show("Copied");
                return result;
            }
            pill.setCopyFailure();
            toast.show("Copy failed");
            return result;
        }
        if (action === "note") {
            return openQuickNotePanel();
        }
        if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
            pill.flash("Failed");
            toast.show("Capture unavailable");
            return { ok: false, error: { code: "capture_unavailable" } };
        }
        if (state.pendingAction) {
            return { ok: false, error: { code: "capture_pending" } };
        }
        state.pendingAction = action;
        pill.flash("Saving", 0);
        try {
            const payload = state.currentSnapshot.payload;
            const result = action === "cite"
                ? await runtimeClient.createCitation(payload)
                : action === "quote"
                    ? await runtimeClient.createQuote(payload)
                    : { ok: false, error: { message: "Unsupported action." } };
            if (result?.ok) {
                pill.flash("Saved");
                toast.show(action === "cite" ? "Citation saved" : "Quote saved");
                return result;
            }
            pill.flash("Failed");
            toast.show(describeCaptureFailure(result));
            return result;
        }
        finally {
            state.pendingAction = "";
        }
    }
    function onKeydown(event) {
        if (quickNotePanel.isVisible()) {
            if (String(event?.key || "").toLowerCase() === "escape") {
                closeQuickNotePanel("escape");
            }
            return;
        }
        if (!state.visible) {
            return;
        }
        if (String(event?.key || "").toLowerCase() === "escape") {
            hide("escape");
            return;
        }
        if (!isCommandShortcut(event)) {
            return;
        }
        const key = String(event?.key || "").toLowerCase();
        if (key !== "c") {
            return;
        }
        event.preventDefault?.();
        void runAction("copy");
    }
    function onPointerDown(event) {
        state.isPointerSelecting = true;
        if (quickNotePanel.isVisible()) {
            if (quickNotePanel.isInsidePanel(event?.target)) {
                return;
            }
            closeQuickNotePanel("outside_click");
            return;
        }
        if (!state.visible) {
            return;
        }
        if (pill.isInsidePill(event?.target)) {
            return;
        }
        hide("outside_click");
    }
    function onPointerUp() {
        state.isPointerSelecting = false;
        scheduleInspect(90);
    }
    function destroy() {
        while (listeners.length) {
            listeners.pop()?.();
        }
        if (observer?.disconnect) {
            observer.disconnect();
        }
        observer = null;
        if (inspectTimer && clearTimeoutRef) {
            clearTimeoutRef(inspectTimer);
            inspectTimer = null;
        }
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        toast.destroy();
        quickNotePanel.destroy();
        pill.destroy();
        state.enabled = false;
    }
    function bootstrap() {
        if (state.enabled) {
            return getState();
        }
        state.enabled = true;
        addListener(documentRef, "selectionchange", () => scheduleInspect(90), true);
        addListener(documentRef, "mouseup", onPointerUp, true);
        addListener(documentRef, "pointerup", onPointerUp, true);
        addListener(documentRef, "keyup", () => {
            state.isPointerSelecting = false;
            scheduleInspect(60);
        }, true);
        addListener(documentRef, "keydown", onKeydown, true);
        addListener(documentRef, "pointerdown", onPointerDown, true);
        addListener(documentRef, "mousedown", onPointerDown, true);
        addListener(documentRef, "click", onPointerDown, true);
        addListener(windowRef, "scroll", scheduleInspect, true);
        addListener(windowRef, "resize", scheduleInspect, true);
        if (MutationObserverRef && documentRef?.documentElement) {
            observer = new MutationObserverRef(() => scheduleInspect());
            observer.observe(documentRef.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
            });
        }
        inspectSelection();
        return getState();
    }
    function getState() {
        return {
            enabled: state.enabled,
            visible: state.visible,
            inspectCount: state.inspectCount,
            renderCount: state.renderCount,
            dismissCount: state.dismissCount,
            lastDismissReason: state.lastDismissReason,
            pendingAction: state.pendingAction,
            currentSignature: state.currentSignature,
            currentSnapshot: state.currentSnapshot,
            pill: pill.getState(),
            quickNotePanel: quickNotePanel.getState(),
        };
    }
    return {
        bootstrap,
        destroy,
        inspectSelection,
        scheduleInspect,
        getState,
        pill,
        quickNotePanel,
    };
}
