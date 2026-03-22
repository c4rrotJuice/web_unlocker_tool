export function createTierBadge({ documentRef = globalThis.document, tier = "guest", } = {}) {
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
    root.style.border = "1px solid transparent";
    function labelForTier(normalized) {
        if (!normalized) {
            return "Guest";
        }
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }
    function setTier(nextTier) {
        const normalized = String(nextTier || "guest").trim().toLowerCase() || "guest";
        root.textContent = labelForTier(normalized);
        root.setAttribute("data-tier", normalized);
        if (normalized === "pro") {
            root.style.background = "#dbeafe";
            root.style.color = "#1d4ed8";
            root.style.borderColor = "rgba(59, 130, 246, 0.24)";
            return;
        }
        if (normalized === "standard") {
            root.style.background = "#dcfce7";
            root.style.color = "#166534";
            root.style.borderColor = "rgba(34, 197, 94, 0.24)";
            return;
        }
        if (normalized === "free") {
            root.style.background = "#fef3c7";
            root.style.color = "#92400e";
            root.style.borderColor = "rgba(245, 158, 11, 0.24)";
            return;
        }
        root.style.background = "#e2e8f0";
        root.style.color = "#334155";
        root.style.borderColor = "rgba(100, 116, 139, 0.22)";
    }
    setTier(tier);
    return { root, setTier };
}
