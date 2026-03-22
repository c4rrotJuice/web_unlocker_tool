import { createTierBadge } from "./tier_badge.ts";

export function createProfileCard({
  documentRef = globalThis.document,
  profile = null,
  entitlement = null,
  bootstrap = null,
  onOpenEditor,
  onOpenDashboard,
  onSignOut,
} = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-profile-card", "true");
  root.style.display = "grid";
  root.style.gap = "12px";
  root.style.padding = "16px";
  root.style.borderRadius = "20px";
  root.style.background = "rgba(15, 23, 42, 0.88)";
  root.style.border = "1px solid rgba(148, 163, 184, 0.18)";

  const header = documentRef.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "12px";

  const left = documentRef.createElement("div");
  left.style.display = "grid";
  left.style.gap = "4px";

  const name = documentRef.createElement("div");
  name.style.fontSize = "18px";
  name.style.fontWeight = "700";
  name.style.color = "#f8fafc";

  const subline = documentRef.createElement("div");
  subline.style.fontSize = "13px";
  subline.style.color = "#94a3b8";

  const badge = createTierBadge({
    documentRef,
    tier: entitlement?.tier || bootstrap?.entitlement?.tier || "guest",
  });

  left.appendChild(name);
  left.appendChild(subline);
  header.appendChild(left);
  header.appendChild(badge.root);

  const actions = documentRef.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  function createButton(label, handler, kind = "secondary") {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.padding = "8px 10px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    button.style.background = kind === "primary" ? "rgba(59, 130, 246, 0.18)" : "rgba(15, 23, 42, 0.72)";
    button.style.color = "#f8fafc";
    button.style.cursor = "pointer";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      handler?.();
    });
    return button;
  }

  const editorButton = createButton("Open editor", onOpenEditor, "primary");
  const dashboardButton = createButton("Open dashboard", onOpenDashboard);
  const signOutButton = createButton("Sign out", onSignOut);

  actions.appendChild(editorButton);
  actions.appendChild(dashboardButton);
  actions.appendChild(signOutButton);

  function render(nextProfile = profile, nextEntitlement = entitlement, nextBootstrap = bootstrap) {
    const displayName = nextProfile?.display_name || nextProfile?.email || "Writior";
    name.textContent = displayName;
    const tier = nextEntitlement?.tier || nextBootstrap?.entitlement?.tier || "guest";
    badge.setTier(tier);
    subline.textContent = nextProfile?.use_case || nextProfile?.email || "Backend-confirmed companion";
  }

  render();
  root.appendChild(header);
  root.appendChild(actions);

  return {
    root,
    render,
  };
}
