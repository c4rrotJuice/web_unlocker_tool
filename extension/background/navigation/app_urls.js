// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { API_ORIGIN } from "../../shared/constants/endpoints.js";
function readBootstrapApp(stateStore) {
    const app = stateStore?.getState?.()?.bootstrap?.app;
    return app && typeof app === "object" ? app : null;
}
export function getAppOrigin(stateStore) {
    const origin = readBootstrapApp(stateStore)?.origin;
    return typeof origin === "string" && origin.trim() ? origin.trim() : API_ORIGIN;
}
export function resolveCanonicalUrl(urlOrPath, stateStore) {
    if (typeof urlOrPath !== "string" || !urlOrPath.trim()) {
        return "";
    }
    try {
        return new URL(urlOrPath.trim(), getAppOrigin(stateStore)).toString();
    }
    catch {
        return "";
    }
}
function readCandidate(app, candidates = []) {
    for (const candidate of candidates) {
        const value = candidate.split(".").reduce((current, key) => current?.[key], app);
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
}
export function resolveCanonicalDestinationUrl(stateStore, destination) {
    const app = readBootstrapApp(stateStore);
    if (!app) {
        return "";
    }
    if (destination === "editor") {
        return resolveCanonicalUrl(readCandidate(app, [
            "handoff.preferred_destination",
            "routes.editor_url",
            "routes.editor_path",
            "editor_url",
            "editor_path",
        ]), stateStore);
    }
    if (destination === "dashboard") {
        return resolveCanonicalUrl(readCandidate(app, [
            "routes.dashboard_url",
            "routes.dashboard_path",
            "dashboard_url",
            "dashboard_path",
        ]), stateStore);
    }
    return "";
}
