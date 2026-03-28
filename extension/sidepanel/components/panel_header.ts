import { createTierBadge } from "./tier_badge.ts";
import { createWritiorLogo } from "./writior_logo.ts";

function normalizeText(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function createPanelHeader({ documentRef = globalThis.document } = {}) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-panel-header", "true");
  root.style.display = "grid";
  root.style.gridTemplateColumns = "auto 1fr auto";
  root.style.gap = "12px";
  root.style.alignItems = "center";

  const logo = createWritiorLogo({ documentRef, size: 32 });
  const copy = documentRef.createElement("div");
  copy.style.display = "grid";
  copy.style.gap = "2px";
  copy.style.minWidth = "0";

  const title = documentRef.createElement("div");
  title.textContent = "Writior";
  title.style.fontSize = "16px";
  title.style.lineHeight = "1.1";
  title.style.fontWeight = "700";
  title.style.color = "#f8fafc";

  const identity = documentRef.createElement("div");
  identity.setAttribute("data-profile-identity", "true");
  identity.style.fontSize = "12px";
  identity.style.lineHeight = "1.35";
  identity.style.color = "#94a3b8";
  identity.style.overflow = "hidden";
  identity.style.textOverflow = "ellipsis";
  identity.style.whiteSpace = "nowrap";

  const badge = createTierBadge({ documentRef, tier: "guest" });

  copy.append(title, identity);
  root.append(logo, copy, badge.root);

  function render({ profile = null, fallbackEmail = "", auth = null, tier = "guest" } = {}) {
    const signedIn = auth?.status === "signed_in" || auth?.status === "refreshing";
    const displayName = normalizeText(profile?.display_name || profile?.username || profile?.name);
    const email = normalizeText(profile?.email || fallbackEmail || auth?.session?.email);
    identity.textContent = signedIn ? (displayName || email || "Signed in") : "Not signed in";
    badge.setTier(tier);
  }

  return { root, render };
}

export const createProfileHeader = createPanelHeader;
