// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { AUTH_STATUS } from "../../shared/types/auth.js";
import { normalizeCapabilitySurface } from "../../shared/types/capability_surface.js";
function summarizeStatus(snapshot) {
    const status = snapshot?.status || AUTH_STATUS.SIGNED_OUT;
    if (status === AUTH_STATUS.LOADING) {
        return "Loading session";
    }
    if (status === AUTH_STATUS.REFRESHING) {
        return "Refreshing session";
    }
    if (status === AUTH_STATUS.ERROR) {
        return snapshot?.error?.message || "Auth error";
    }
    if (status === AUTH_STATUS.SIGNED_IN) {
        return snapshot?.bootstrap?.profile?.display_name || snapshot?.session?.email || "Signed in";
    }
    return "Not signed in";
}
export function renderPopupAuthSnapshot(root, snapshot) {
    if (!root) {
        return { mounted: false };
    }
    root.innerHTML = "";
    const surface = normalizeCapabilitySurface({ auth: snapshot });
    const section = document.createElement("section");
    section.setAttribute("data-surface", "popup");
    section.style.display = "grid";
    section.style.gap = "6px";
    const title = document.createElement("div");
    title.textContent = "Writior";
    title.style.fontSize = "16px";
    title.style.fontWeight = "700";
    title.style.color = "#f8fafc";
    const identity = document.createElement("div");
    identity.textContent = summarizeStatus(snapshot);
    identity.style.fontSize = "12px";
    identity.style.color = "#cbd5e1";
    const tier = document.createElement("div");
    tier.textContent = `Tier ${surface.tierLabel || "Guest"}`;
    tier.style.fontSize = "11px";
    tier.style.color = "#94a3b8";
    section.append(title, identity, tier);
    root.appendChild(section);
    return { mounted: true };
}
