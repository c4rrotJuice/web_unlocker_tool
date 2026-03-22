import { CITATION_STYLES } from "./citation.ts";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readUsageItems(source: any = {}) {
  if (!source || typeof source !== "object") {
    return [];
  }
  if (Array.isArray(source.usage)) {
    return source.usage
      .map((item) => ({
        label: normalizeText(item?.label || item?.name || ""),
        value: normalizeText(item?.value ?? item?.count ?? item?.remaining ?? ""),
      }))
      .filter((item) => item.label && item.value);
  }
  if (source.usage && typeof source.usage === "object") {
    return Object.entries(source.usage)
      .map(([label, value]) => ({
        label: normalizeText(label),
        value: normalizeText(value),
      }))
      .filter((item) => item.label && item.value);
  }
  return [];
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
  const tier = normalizeText(entitlement?.tier || "guest") || "guest";
  const citationStyles = Array.isArray(capabilities.citation_styles)
    ? capabilities.citation_styles.map((style) => normalizeText(style).toLowerCase()).filter(Boolean)
    : [];
  const usageItems = readUsageItems(bootstrapState);
  if (!usageItems.length) {
    usageItems.push(
      { label: "Tier", value: tier },
      { label: "Styles", value: String(citationStyles.length || CITATION_STYLES.length) },
      { label: "Projects", value: String(Array.isArray(taxonomy.recent_projects) ? taxonomy.recent_projects.length : 0) },
      { label: "Tags", value: String(Array.isArray(taxonomy.recent_tags) ? taxonomy.recent_tags.length : 0) },
    );
  }
  return {
    auth: authState,
    bootstrap: bootstrapState,
    tier,
    usageItems,
    lockedStyles: citationStyles.length
      ? CITATION_STYLES.filter((style) => !citationStyles.includes(style))
      : [],
  };
}
