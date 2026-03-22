import { createProfileCard, createUsageSummaryList } from "../components/index.js";
import { normalizeCapabilitySurface } from "../../shared/types/capability_surface.js";

export function renderAuthView(root, snapshot = {}, options = {}) {
  if (!root) {
    return { mounted: false };
  }
  const documentRef = options.documentRef || globalThis.document;
  const surface = normalizeCapabilitySurface({
    auth: snapshot?.auth || snapshot || null,
    bootstrap: snapshot?.auth?.bootstrap || snapshot?.bootstrap || null,
  });
  const wrapper = documentRef.createElement("section");
  wrapper.setAttribute("data-auth-view", "true");
  wrapper.style.display = "grid";
  wrapper.style.gap = "12px";

  const profileCard = createProfileCard({
    documentRef,
    profile: snapshot?.auth?.bootstrap?.profile || snapshot?.bootstrap?.profile || snapshot?.auth?.session || null,
    entitlement: snapshot?.auth?.bootstrap?.entitlement || snapshot?.bootstrap?.entitlement || null,
    bootstrap: snapshot?.auth?.bootstrap || snapshot?.bootstrap || null,
    onOpenEditor: options.onOpenEditor,
    onOpenDashboard: options.onOpenDashboard,
    onSignOut: options.onSignOut,
  });

  const usageSummary = createUsageSummaryList({
    documentRef,
    items: surface.usageItems,
  });

  const signedOutCopy = documentRef.createElement("div");
  signedOutCopy.textContent = "Signed out. Open the app when you are ready to continue.";
  signedOutCopy.style.color = "#cbd5e1";

  const signedInCopy = documentRef.createElement("div");
  signedInCopy.textContent = "Connected to the backend. Recent items below are confirmed server data.";
  signedInCopy.style.color = "#94a3b8";

  function render(nextSnapshot = snapshot) {
    wrapper.innerHTML = "";
    profileCard.render(
      nextSnapshot?.auth?.bootstrap?.profile || nextSnapshot?.bootstrap?.profile || nextSnapshot?.auth?.session || null,
      nextSnapshot?.auth?.bootstrap?.entitlement || nextSnapshot?.bootstrap?.entitlement || null,
      nextSnapshot?.auth?.bootstrap || nextSnapshot?.bootstrap || null,
    );
    usageSummary.render(normalizeCapabilitySurface({ auth: nextSnapshot?.auth || nextSnapshot || null, bootstrap: nextSnapshot?.auth?.bootstrap || nextSnapshot?.bootstrap || null }).usageItems);
    wrapper.appendChild(profileCard.root);
    if (nextSnapshot?.status === "signed_out") {
      wrapper.appendChild(signedOutCopy);
    } else if (nextSnapshot?.status === "signed_in" || nextSnapshot?.auth?.status === "signed_in") {
      wrapper.appendChild(signedInCopy);
    }
    wrapper.appendChild(usageSummary.root);
  }

  render(snapshot);
  root.innerHTML = "";
  root.appendChild(wrapper);

  return {
    mounted: true,
    render,
  };
}
