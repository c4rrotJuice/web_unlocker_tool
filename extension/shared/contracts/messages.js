import { MESSAGE_NAMES } from "../constants/message_names.js";
import { SURFACE_NAMES } from "../types/contracts.js";
function createRequest(type, requestId, payload) {
    return { type, requestId, payload };
}
export function createPingRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.PING, requestId, payload);
}
export function createOpenSidepanelRequest(requestId, surface) {
    return createRequest(MESSAGE_NAMES.OPEN_SIDEPANEL, requestId, { surface });
}
export function createAuthStartRequest(requestId, surface, trigger, redirectPath = undefined) {
    return createRequest(MESSAGE_NAMES.AUTH_START, requestId, {
        surface,
        trigger,
        redirectPath,
    });
}
export function createAuthStatusGetRequest(requestId, surface) {
    return createRequest(MESSAGE_NAMES.AUTH_STATUS_GET, requestId, { surface });
}
export function createAuthLogoutRequest(requestId, surface) {
    return createRequest(MESSAGE_NAMES.AUTH_LOGOUT, requestId, { surface });
}
export function createBootstrapFetchRequest(requestId, surface) {
    return createRequest(MESSAGE_NAMES.BOOTSTRAP_FETCH, requestId, { surface });
}
export function createSidepanelListRecentCitationsRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_CITATIONS, requestId, payload);
}
export function createSidepanelListRecentNotesRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_NOTES, requestId, payload);
}
export function createSidepanelOpenEditorRequest(requestId, surface) {
    return createRequest(MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR, requestId, { surface });
}
export function createSidepanelOpenDashboardRequest(requestId, surface) {
    return createRequest(MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD, requestId, { surface });
}
export function createCaptureCreateCitationRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.CAPTURE_CREATE_CITATION, requestId, payload);
}
export function createCaptureCreateQuoteRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.CAPTURE_CREATE_QUOTE, requestId, payload);
}
export function createCaptureCreateNoteRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.CAPTURE_CREATE_NOTE, requestId, payload);
}
export function createCitationRenderRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.CITATION_RENDER, requestId, payload);
}
export function createCitationSaveRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.CITATION_SAVE, requestId, payload);
}
export function createWorkInEditorRequest(requestId, payload) {
    return createRequest(MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST, requestId, payload);
}
export { SURFACE_NAMES };
