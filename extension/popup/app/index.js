// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { AUTH_STATUS } from "../../shared/types/auth.js";
import { normalizeCapabilitySurface } from "../../shared/types/capability_surface.js";
function summarizeStatus(snapshot) {
    const status = snapshot?.status || AUTH_STATUS.SIGNED_OUT;
    if (status === AUTH_STATUS.LOADING) {
        return "Loading auth state";
    }
    if (status === AUTH_STATUS.ERROR) {
        return `Auth error: ${snapshot?.error?.message || "unknown"}`;
    }
    if (status === AUTH_STATUS.SIGNED_IN) {
        return `Signed in${snapshot?.session?.email ? ` as ${snapshot.session.email}` : ""}`;
    }
    return "Signed out";
}
export function renderPopupAuthSnapshot(root, snapshot) {
    if (!root) {
        return { mounted: false };
    }
    root.innerHTML = "";
    const surface = normalizeCapabilitySurface({ auth: snapshot });
    const usageText = surface.usageItems.length
        ? surface.usageItems.map((item) => `${item.label}: ${item.value}`).join(" • ")
        : "Usage updates appear here when available.";
    root.innerHTML = `
    <section data-surface="popup">
      <h1>Writior</h1>
      <p>${summarizeStatus(snapshot)}</p>
      <p>Tier ${surface.tier}</p>
      <p>${usageText}</p>
    </section>
  `;
    return { mounted: true };
}
