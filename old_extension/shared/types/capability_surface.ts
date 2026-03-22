import { CITATION_STYLES } from "./citation.ts";

const ACTION_KEYS = Object.freeze(["copy", "work_in_editor", "cite", "note", "quote"]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeActionMap(value) {
  const state = {};
  if (Array.isArray(value)) {
    for (const key of value) {
      if (ACTION_KEYS.includes(key)) {
        state[key] = true;
      }
    }
    return state;
  }
  if (value && typeof value === "object") {
    for (const key of ACTION_KEYS) {
      if (typeof value[key] === "boolean") {
        state[key] = value[key];
      } else if (typeof value[key] === "string") {
        const normalized = value[key].trim().toLowerCase();
        if (normalized === "true" || normalized === "locked" || normalized === "enabled") {
          state[key] = true;
        } else if (normalized === "false" || normalized === "disabled" || normalized === "locked_false") {
          state[key] = false;
        }
      } else if (typeof value[key] === "number") {
        state[key] = value[key] > 0;
      }
    }
  }
  return state;
}

function readUsageItems(source = {}) {
  if (!source || typeof source !== "object") {
    return [];
  }
  const excluded = new Set(["tier", "status"]);
  if (Array.isArray(source.usage)) {
    return source.usage
      .map((item) => ({
        label: normalizeText(item?.label || item?.name || ""),
        value: normalizeText(item?.value ?? item?.count ?? item?.remaining ?? ""),
      }))
      .filter((item) => item.label && !excluded.has(item.label.toLowerCase()));
  }
  if (source.usage && typeof source.usage === "object") {
    return Object.entries(source.usage)
      .map(([label, value]) => ({
        label: normalizeText(label),
        value: normalizeText(value),
      }))
      .filter((item) => item.label && !excluded.has(item.label.toLowerCase()));
  }
  return [];
}

export function normalizeCapabilitySurface({ auth = null, bootstrap = null } = {}) {
  const authState = auth && typeof auth === "object" ? auth : null;
  const bootstrapState = bootstrap || authState?.bootstrap || null;
  const entitlement = bootstrapState?.entitlement || null;
  const capabilities = bootstrapState?.capabilities && typeof bootstrapState.capabilities === "object" ? bootstrapState.capabilities : {};
  const taxonomy = bootstrapState?.taxonomy && typeof bootstrapState.taxonomy === "object" ? bootstrapState.taxonomy : {};
  const tier = normalizeText(entitlement?.tier || bootstrapState?.tier || authState?.tier || "guest") || "guest";
  const citationStyles = Array.isArray(capabilities.citation_styles) ? capabilities.citation_styles.map((style) => String(style || "").trim()).filter(Boolean) : [];
  const lockedStyles = citationStyles.length ? CITATION_STYLES.filter((style) => !citationStyles.includes(style)) : [];
  const explicitActionMap = normalizeActionMap(
    capabilities.pill_actions
      || capabilities.selection_actions
      || capabilities.action_states
      || capabilities.allowed_actions
      || capabilities.actions,
  );
  const actionAvailability = {
    copy: true,
    work_in_editor: explicitActionMap.work_in_editor ?? (typeof capabilities.work_in_editor === "boolean" ? capabilities.work_in_editor : false),
    cite: explicitActionMap.cite ?? (typeof capabilities.cite === "boolean" ? capabilities.cite : false),
    note: explicitActionMap.note ?? (typeof capabilities.note === "boolean" ? capabilities.note : false),
    quote: explicitActionMap.quote ?? (typeof capabilities.quote === "boolean" ? capabilities.quote : false),
  };
  const unlocks = capabilities.unlocks;
  if (typeof unlocks === "boolean") {
    actionAvailability.work_in_editor = typeof explicitActionMap.work_in_editor === "boolean" ? explicitActionMap.work_in_editor : unlocks;
    actionAvailability.cite = typeof explicitActionMap.cite === "boolean" ? explicitActionMap.cite : unlocks;
    actionAvailability.note = typeof explicitActionMap.note === "boolean" ? explicitActionMap.note : unlocks;
    actionAvailability.quote = typeof explicitActionMap.quote === "boolean" ? explicitActionMap.quote : unlocks;
  }

  const usageItems = [
    ...readUsageItems(bootstrapState),
    ...readUsageItems(capabilities),
  ];
  if (!usageItems.length) {
    usageItems.push(
      { label: "Tier", value: tier },
      { label: "Citation styles", value: String(citationStyles.length || 0) },
      { label: "Recent projects", value: String(Array.isArray(taxonomy.recent_projects) ? taxonomy.recent_projects.length : 0) },
      { label: "Recent tags", value: String(Array.isArray(taxonomy.recent_tags) ? taxonomy.recent_tags.length : 0) },
    );
  }

  return {
    auth: authState,
    bootstrap: bootstrapState,
    tier,
    entitlement,
    capabilities,
    citationStyles,
    lockedStyles,
    actionAvailability,
    usageItems,
    isGuest: tier === "guest" || authState?.status === "signed_out",
  };
}

export function getActionAvailability(surface, actionKey) {
  return Boolean(surface?.actionAvailability?.[actionKey]);
}

export function getUsageItems(surface) {
  return Array.isArray(surface?.usageItems) ? surface.usageItems : [];
}

export function getTierLabel(surface) {
  return surface?.tier || "guest";
}
