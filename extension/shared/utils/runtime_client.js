import { SURFACE_NAMES, createAuthLogoutRequest, createAuthStartRequest, createAuthStatusGetRequest, createBootstrapFetchRequest, createSidepanelListRecentCitationsRequest, createSidepanelListRecentNotesRequest, createSidepanelOpenDashboardRequest, createSidepanelOpenEditorRequest, createCaptureCreateCitationRequest, createCaptureCreateNoteRequest, createCaptureCreateQuoteRequest, createCitationRenderRequest, createCitationSaveRequest, createOpenSidepanelRequest, createPingRequest, createWorkInEditorRequest, } from "../contracts/messages.js";
import { createRequestId } from "./request_id.js";
import { sendRuntimeMessage } from "./runtime_message.js";
export function createRuntimeClient(chromeApi, surface) {
    return {
        ping(payload = {}) {
            const requestId = createRequestId(`${surface}-ping`);
            return sendRuntimeMessage(chromeApi, createPingRequest(requestId, {
                surface,
                ...payload,
            }));
        },
        openSidepanel() {
            const requestId = createRequestId(`${surface}-open-sidepanel`);
            return sendRuntimeMessage(chromeApi, createOpenSidepanelRequest(requestId, surface));
        },
        authStart({ trigger = "manual", redirectPath = undefined } = {}) {
            const requestId = createRequestId(`${surface}-auth-start`);
            return sendRuntimeMessage(chromeApi, createAuthStartRequest(requestId, surface, trigger, redirectPath));
        },
        authStatusGet() {
            const requestId = createRequestId(`${surface}-auth-status`);
            return sendRuntimeMessage(chromeApi, createAuthStatusGetRequest(requestId, surface));
        },
        authLogout() {
            const requestId = createRequestId(`${surface}-auth-logout`);
            return sendRuntimeMessage(chromeApi, createAuthLogoutRequest(requestId, surface));
        },
        bootstrapFetch() {
            const requestId = createRequestId(`${surface}-bootstrap-fetch`);
            return sendRuntimeMessage(chromeApi, createBootstrapFetchRequest(requestId, surface));
        },
        listRecentCitations({ limit = 8, offset = 0, query = "" } = {}) {
            const requestId = createRequestId(`${surface}-list-recent-citations`);
            return sendRuntimeMessage(chromeApi, createSidepanelListRecentCitationsRequest(requestId, {
                surface,
                limit,
                offset,
                query,
            }));
        },
        listRecentNotes({ limit = 8, offset = 0, query = "" } = {}) {
            const requestId = createRequestId(`${surface}-list-recent-notes`);
            return sendRuntimeMessage(chromeApi, createSidepanelListRecentNotesRequest(requestId, {
                surface,
                limit,
                offset,
                query,
            }));
        },
        openEditor() {
            const requestId = createRequestId(`${surface}-open-editor`);
            return sendRuntimeMessage(chromeApi, createSidepanelOpenEditorRequest(requestId, surface));
        },
        openDashboard() {
            const requestId = createRequestId(`${surface}-open-dashboard`);
            return sendRuntimeMessage(chromeApi, createSidepanelOpenDashboardRequest(requestId, surface));
        },
        createCitation(payload) {
            const requestId = createRequestId(`${surface}-create-citation`);
            return sendRuntimeMessage(chromeApi, createCaptureCreateCitationRequest(requestId, {
                surface,
                ...payload,
            }));
        },
        createQuote(payload) {
            const requestId = createRequestId(`${surface}-create-quote`);
            return sendRuntimeMessage(chromeApi, createCaptureCreateQuoteRequest(requestId, {
                surface,
                ...payload,
            }));
        },
        createNote(payload) {
            const requestId = createRequestId(`${surface}-create-note`);
            return sendRuntimeMessage(chromeApi, createCaptureCreateNoteRequest(requestId, {
                surface,
                ...payload,
            }));
        },
        renderCitation(payload) {
            const requestId = createRequestId(`${surface}-render-citation`);
            return sendRuntimeMessage(chromeApi, createCitationRenderRequest(requestId, {
                surface,
                ...payload,
            }));
        },
        saveCitation(payload) {
            const requestId = createRequestId(`${surface}-save-citation`);
            return sendRuntimeMessage(chromeApi, createCitationSaveRequest(requestId, {
                surface,
                ...payload,
            }));
        },
        workInEditorRequest(payload) {
            const requestId = createRequestId(`${surface}-work-in-editor`);
            return sendRuntimeMessage(chromeApi, createWorkInEditorRequest(requestId, {
                surface,
                ...payload,
            }));
        },
    };
}
export { SURFACE_NAMES };
