export function createTierBadge({
  documentRef = globalThis.document,
  tier = "guest",
} = {}) {
  const root = documentRef.createElement("span");
  root.setAttribute("data-tier-badge", "true");
  root.style.display = "inline-flex";
  root.style.alignItems = "center";
  root.style.padding = "4px 8px";
  root.style.borderRadius = "999px";
  root.style.fontSize = "11px";
  root.style.fontWeight = "700";
  root.style.textTransform = "uppercase";
  root.style.letterSpacing = "0.04em";

  function setTier(nextTier) {
    const normalized = String(nextTier || "guest").trim().toLowerCase() || "guest";
    root.textContent = normalized;
    if (normalized === "pro") {
      root.style.background = "#dbeafe";
      root.style.color = "#1d4ed8";
      return;
    }
    if (normalized === "free" || normalized === "guest") {
      root.style.background = "#e2e8f0";
      root.style.color = "#334155";
      return;
    }
    root.style.background = "#dcfce7";
    root.style.color = "#166534";
  }

  setTier(tier);
  return { root, setTier };
}
