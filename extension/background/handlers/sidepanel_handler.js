// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { createErrorResult, createOkResult, ERROR_CODES } from "../../shared/types/messages.js";
import { resolveCanonicalDestinationUrl } from "../navigation/app_urls.js";
export function createSidepanelHandler(options = {}) {
    const { apiClient, stateStore, tabOpener } = options;
    if (!apiClient?.listCitations || !apiClient?.listNotes || !apiClient?.updateNote) {
        throw new Error("createSidepanelHandler requires listCitations, listNotes, and updateNote support.");
    }
    if (!stateStore) {
        throw new Error("createSidepanelHandler requires a stateStore.");
    }
    if (!tabOpener?.open) {
        throw new Error("createSidepanelHandler requires a tabOpener.");
    }
    return {
        async listRecentCitations(request) {
            const payload = request?.payload || {};
            const result = await apiClient.listCitations(payload);
            if (result?.ok === false) {
                return result;
            }
            return createOkResult({
                items: Array.isArray(result.data) ? result.data : result.data?.items || [],
            }, request?.requestId);
        },
        async listRecentNotes(request) {
            const payload = request?.payload || {};
            const result = await apiClient.listNotes(payload);
            if (result?.ok === false) {
                return result;
            }
            return createOkResult({
                items: Array.isArray(result.data) ? result.data : result.data?.items || [],
            }, request?.requestId);
        },
        async updateNote(request) {
            const payload = request?.payload || {};
            const result = await apiClient.updateNote(payload);
            if (result?.ok === false) {
                return result;
            }
            return createOkResult({
                note: result.data,
            }, request?.requestId);
        },
        async openEditor(request) {
            const url = resolveCanonicalDestinationUrl(stateStore, "editor");
            if (!url) {
                return createErrorResult(ERROR_CODES.INVALID_CONTEXT, "Editor URL is unavailable from bootstrap.", request?.requestId);
            }
            return tabOpener.open(url, request?.requestId, "editor");
        },
        async openDashboard(request) {
            const url = resolveCanonicalDestinationUrl(stateStore, "dashboard");
            if (!url) {
                return createErrorResult(ERROR_CODES.INVALID_CONTEXT, "Dashboard URL is unavailable from bootstrap.", request?.requestId);
            }
            return tabOpener.open(url, request?.requestId, "dashboard");
        },
    };
}
