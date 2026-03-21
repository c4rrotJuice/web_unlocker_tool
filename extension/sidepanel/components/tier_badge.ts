export function createTierBadge({
  documentRef = globalThis.document,
  tier = "free",
} = {}) {
  function applyTierTheme(nextTier) {
    const normalized = String(nextTier || "guest").toLowerCase();
    if (normalized === "pro") {
      root.style.background = "rgba(14, 165, 233, 0.18)";
      root.style.color = "#e0f2fe";
    } else if (normalized === "standard") {
      root.style.background = "rgba(59, 130, 246, 0.16)";
      root.style.color = "#dbeafe";
    } else if (normalized === "guest") {
      root.style.background = "rgba(71, 85, 105, 0.22)";
      root.style.color = "#e2e8f0";
    } else {
      root.style.background = "rgba(148, 163, 184, 0.14)";
      root.style.color = "#e2e8f0";
    }
  }
  const root = documentRef.createElement("span");
  root.setAttribute("data-tier-badge", "true");
  root.style.display = "inline-flex";
  root.style.alignItems = "center";
  root.style.padding = "4px 8px";
  root.style.borderRadius = "999px";
  root.style.fontSize = "11px";
  root.style.fontWeight = "700";
  root.style.letterSpacing = "0.04em";
  root.style.textTransform = "uppercase";
  applyTierTheme(tier);
  root.textContent = tier;

  return {
    root,
    setTier(nextTier) {
      root.textContent = nextTier || "guest";
      applyTierTheme(nextTier);
    },
  };
}
