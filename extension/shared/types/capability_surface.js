import { CITATION_STYLES } from "./citation.js";
function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function normalizeTier(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "guest" || normalized === "free" || normalized === "standard" || normalized === "pro") {
        return normalized;
    }
    return normalized || "guest";
}
function toTitleCase(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "";
}
function formatUsageLabel(label) {
    const normalized = normalizeText(label);
    if (!normalized) {
        return "";
    }
    return normalized
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\bper week\b/gi, "/week")
        .replace(/\bper day\b/gi, "/day")
        .replace(/\bper month\b/gi, "/month")
        .replace(/\b([a-z])/gi, (match) => match.toUpperCase());
}
function formatUsageValue(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : "";
    }
    if (typeof value === "boolean") {
        return value ? "Enabled" : "";
    }
    return normalizeText(value);
}
function readUsageItems(source = {}) {
    if (!source || typeof source !== "object") {
        return [];
    }
    const usageSource = source?.capabilities?.usage ?? source?.usage ?? null;
    if (Array.isArray(usageSource)) {
        return usageSource
            .map((item) => ({
            label: formatUsageLabel(item?.label || item?.name || ""),
            value: formatUsageValue(item?.value ?? item?.count ?? item?.remaining ?? ""),
        }))
            .filter((item) => item.label && item.value && item.label.toLowerCase() !== "tier");
    }
    if (usageSource && typeof usageSource === "object") {
        return Object.entries(usageSource)
            .map(([label, value]) => ({
            label: formatUsageLabel(label),
            value: formatUsageValue(value),
        }))
            .filter((item) => item.label && item.value && item.label.toLowerCase() !== "tier");
    }
    return [];
}
function readActionAvailability(authState = null, capabilities = {}) {
    const selectionActions = capabilities?.selection_actions;
    const genericActions = capabilities?.actions;
    const pillActions = capabilities?.extension?.pill_actions;
    const merged = {
        ...(selectionActions && typeof selectionActions === "object" ? selectionActions : {}),
        ...(genericActions && typeof genericActions === "object" ? genericActions : {}),
        ...(pillActions && typeof pillActions === "object" ? pillActions : {}),
    };
    if (typeof capabilities?.extension?.work_in_editor_flow === "boolean" && merged.work_in_editor == null) {
        merged.work_in_editor = capabilities.extension.work_in_editor_flow;
    }
    if (Object.keys(merged).length) {
        return {
            copy: merged.copy !== false,
            cite: merged.cite,
            note: merged.note,
            quote: merged.quote,
            work_in_editor: merged.work_in_editor,
        };
    }
    if (authState?.status === "signed_out") {
        return {
            copy: true,
            cite: false,
            note: false,
            quote: false,
            work_in_editor: false,
        };
    }
    return {
        copy: true,
        cite: undefined,
        note: undefined,
        quote: undefined,
        work_in_editor: undefined,
    };
}
export function normalizeCapabilitySurface({ auth = null, bootstrap = null } = {}) {
    const authState = auth && typeof auth === "object" ? auth : null;
    const bootstrapState = bootstrap || authState?.bootstrap || null;
    const entitlement = bootstrapState?.entitlement || null;
    const capabilities = bootstrapState?.capabilities && typeof bootstrapState.capabilities === "object"
        ? bootstrapState.capabilities
        : {};
    const taxonomy = bootstrapState?.taxonomy && typeof bootstrapState.taxonomy === "object"
        ? bootstrapState.taxonomy
        : {};
    const tier = normalizeTier(entitlement?.tier || (authState?.status === "signed_out" ? "guest" : ""));
    const citationStyles = Array.isArray(capabilities.citation_styles)
        ? capabilities.citation_styles.map((style) => normalizeText(style).toLowerCase()).filter(Boolean)
        : [];
    const usageItems = readUsageItems(bootstrapState);
    return {
        auth: authState,
        bootstrap: bootstrapState,
        tier,
        tierLabel: toTitleCase(tier),
        entitlementStatus: normalizeText(entitlement?.status || ""),
        usageItems,
        actionAvailability: readActionAvailability(authState, capabilities),
        hasUsageSummary: usageItems.length > 0,
        lockedStyles: citationStyles.length
            ? CITATION_STYLES.filter((style) => !citationStyles.includes(style))
            : [],
        recentProjectCount: Array.isArray(taxonomy.recent_projects) ? taxonomy.recent_projects.length : 0,
        recentTagCount: Array.isArray(taxonomy.recent_tags) ? taxonomy.recent_tags.length : 0,
    };
}
