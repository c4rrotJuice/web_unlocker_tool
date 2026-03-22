import { createTierBadge } from "./tier_badge.js";
function createActionButton(documentRef, label, onClick, tone = "neutral") {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.padding = "8px 10px";
    button.style.borderRadius = "999px";
    button.style.border = "1px solid rgba(148, 163, 184, 0.22)";
    button.style.background = tone === "primary" ? "#0f172a" : "#ffffff";
    button.style.color = tone === "primary" ? "#f8fafc" : "#0f172a";
    button.addEventListener("click", (event) => {
        event.preventDefault?.();
        void onClick?.();
    });
    return button;
}
export function createProfileCard(options = {}) {
    const { documentRef = globalThis.document, onOpenEditor, onOpenDashboard, onSignOut, } = options;
    const root = documentRef.createElement("section");
    root.setAttribute("data-profile-card", "true");
    root.style.display = "grid";
    root.style.gap = "12px";
    root.style.padding = "16px";
    root.style.borderRadius = "20px";
    root.style.background = "#fffdf8";
    root.style.border = "1px solid rgba(148, 163, 184, 0.20)";
    const header = documentRef.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "flex-start";
    header.style.gap = "12px";
    const identity = documentRef.createElement("div");
    identity.style.display = "grid";
    identity.style.gap = "4px";
    const name = documentRef.createElement("div");
    name.style.fontSize = "18px";
    name.style.fontWeight = "700";
    name.style.color = "#0f172a";
    const email = documentRef.createElement("div");
    email.style.fontSize = "13px";
    email.style.color = "#475569";
    email.style.overflowWrap = "anywhere";
    const planMeta = documentRef.createElement("div");
    planMeta.style.fontSize = "12px";
    planMeta.style.color = "#64748b";
    const badge = createTierBadge({ documentRef });
    identity.appendChild(name);
    identity.appendChild(email);
    identity.appendChild(planMeta);
    header.appendChild(identity);
    header.appendChild(badge.root);
    const actions = documentRef.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.appendChild(createActionButton(documentRef, "Open editor", onOpenEditor, "primary"));
    actions.appendChild(createActionButton(documentRef, "Open dashboard", onOpenDashboard));
    actions.appendChild(createActionButton(documentRef, "Sign out", onSignOut));
    root.appendChild(header);
    root.appendChild(actions);
    function render(profile = null, entitlement = null, fallbackEmail = "") {
        const tier = String(entitlement?.tier || "guest").trim().toLowerCase() || "guest";
        const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
        name.textContent = profile?.display_name || profile?.email || fallbackEmail || "Writior";
        email.textContent = profile?.email || fallbackEmail || (tier === "guest" ? "Guest session" : "Signed in");
        planMeta.textContent = `Plan ${tierLabel}`;
        badge.setTier(tier);
    }
    return { root, render };
}
