export const CITATION_STYLES = Object.freeze(["apa", "mla", "chicago", "harvard"]);
export const CITATION_RENDER_KINDS = Object.freeze(["inline", "footnote", "bibliography", "quote_attribution"]);

export function normalizeCitationStyle(style, fallback = "apa") {
  const normalized = String(style || fallback).trim().toLowerCase();
  return CITATION_STYLES.includes(normalized) ? normalized : fallback;
}

export function normalizeCitationRenderKind(kind, fallback = "bibliography") {
  const normalized = String(kind || fallback).trim().toLowerCase();
  return CITATION_RENDER_KINDS.includes(normalized) ? normalized : fallback;
}

export function citationRenderBundle(citation) {
  const renderBundle = citation?.render_bundle;
  if (renderBundle && typeof renderBundle === "object") {
    return renderBundle;
  }
  const renders = citation?.renders && typeof citation.renders === "object" ? citation.renders : {};
  const styles = citation?.available_renders?.styles || [];
  const primary = citation?.primary_render || citation?.available_renders?.primary || null;
  return { renders, styles, primary };
}

export function citationAvailableStyles(citation) {
  const bundle = citationRenderBundle(citation);
  const styleEntries = Array.isArray(bundle?.styles) ? bundle.styles.map((entry) => entry?.style).filter(Boolean) : [];
  const renderKeys = Object.keys(bundle?.renders || {}).filter(Boolean);
  const styles = Array.from(new Set([...styleEntries, ...renderKeys])).filter((style) => CITATION_STYLES.includes(style));
  return styles.length ? styles : ["apa", "mla", "chicago", "harvard"];
}

export function citationAvailableKinds(citation, style) {
  const normalizedStyle = normalizeCitationStyle(style);
  const bundle = citationRenderBundle(citation);
  const styleEntry = Array.isArray(bundle?.styles)
    ? bundle.styles.find((entry) => entry?.style === normalizedStyle)
    : null;
  const entryKinds = Array.isArray(styleEntry?.kinds) ? styleEntry.kinds.filter((kind) => CITATION_RENDER_KINDS.includes(kind)) : [];
  const renderKinds = Object.keys(bundle?.renders?.[normalizedStyle] || {}).filter((kind) => CITATION_RENDER_KINDS.includes(kind));
  const kinds = Array.from(new Set([...entryKinds, ...renderKinds]));
  return kinds.length ? kinds : ["bibliography"];
}

export function citationRenderText(citation, { style = "apa", kind = "bibliography" } = {}) {
  const normalizedStyle = normalizeCitationStyle(style);
  const normalizedKind = normalizeCitationRenderKind(kind);
  const bundle = citationRenderBundle(citation);
  const text = bundle?.renders?.[normalizedStyle]?.[normalizedKind];
  if (typeof text === "string" && text.trim()) {
    return text.trim();
  }
  return "";
}

export function resolveCitationView(citation, viewState = {}) {
  const availableStyles = citationAvailableStyles(citation);
  const style = availableStyles.includes(viewState?.style)
    ? viewState.style
    : normalizeCitationStyle(viewState?.style || citation?.primary_render?.style || availableStyles[0] || "apa");
  const availableKinds = citationAvailableKinds(citation, style);
  const preferredKind = normalizeCitationRenderKind(viewState?.kind || citation?.primary_render?.kind || "bibliography");
  const kind = availableKinds.includes(preferredKind)
    ? preferredKind
    : (availableKinds.includes("bibliography") ? "bibliography" : availableKinds[0]);
  const text = citationRenderText(citation, { style, kind }) || citationPrimaryText(citation, "");
  return {
    style,
    kind,
    text,
    availableStyles,
    availableKinds,
    loading: Boolean(viewState?.loading),
    message: viewState?.message || "",
    canCopy: Boolean(text),
  };
}

export function mergeCitationRenderPayload(citation, payload) {
  const currentBundle = citationRenderBundle(citation);
  const incomingBundle = citationRenderBundle(payload);
  const renders = {
    ...(currentBundle?.renders || {}),
    ...(incomingBundle?.renders || payload?.renders || {}),
  };
  const styles = [];
  const styleMap = new Map();
  for (const entry of [...(currentBundle?.styles || []), ...(incomingBundle?.styles || [])]) {
    if (!entry?.style) continue;
    styleMap.set(entry.style, {
      style: entry.style,
      kinds: Array.isArray(entry.kinds) ? entry.kinds.slice() : citationAvailableKinds({ render_bundle: { renders } }, entry.style),
      texts: entry.texts && typeof entry.texts === "object" ? { ...entry.texts } : { ...(renders[entry.style] || {}) },
    });
  }
  for (const style of Object.keys(renders)) {
    if (!styleMap.has(style)) {
      styleMap.set(style, {
        style,
        kinds: citationAvailableKinds({ render_bundle: { renders } }, style),
        texts: { ...(renders[style] || {}) },
      });
    }
  }
  styles.push(...styleMap.values());
  const primary = payload?.primary_render || incomingBundle?.primary || currentBundle?.primary || citation?.primary_render || citation?.available_renders?.primary || null;
  return {
    ...citation,
    ...payload,
    renders,
    render_bundle: {
      renders,
      styles,
      primary,
    },
    primary_render: primary,
    available_renders: {
      styles,
      primary,
    },
  };
}

export function citationPrimaryText(citation, fallback = "Citation saved") {
  return (
    citation?.primary_render?.text
    || citation?.render_bundle?.primary?.text
    || citation?.available_renders?.primary?.text
    || citation?.render_bundle?.renders?.mla?.bibliography
    || citation?.renders?.mla?.bibliography
    || citation?.excerpt
    || citation?.annotation
    || citation?.source?.title
    || fallback
  );
}

export function citationDisplayTitle(citation, fallback = "Citation") {
  const sourceTitle = String(citation?.source?.title || "").trim();
  if (sourceTitle) {
    return sourceTitle;
  }

  const text = String(citationPrimaryText(citation, "") || "").trim();
  if (!text) {
    return fallback;
  }

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.trim() || fallback;
}

export function citationRenderEntries(citation, options = {}) {
  const selectedStyle = options?.style ? normalizeCitationStyle(options.style) : "";
  const bundleStyles = citation?.render_bundle?.styles;
  if (Array.isArray(bundleStyles) && bundleStyles.length) {
    return bundleStyles
      .filter((entry) => !selectedStyle || entry?.style === selectedStyle)
      .flatMap((entry) => citationAvailableKinds(citation, entry.style).map((kind) => ({
        style: entry.style,
        kind,
        text: entry?.texts?.[kind] || "",
      })))
      .filter((entry) => entry.text);
  }
  const styles = citation?.available_renders?.styles;
  if (Array.isArray(styles) && styles.length) {
    return styles
      .filter((entry) => !selectedStyle || entry?.style === selectedStyle)
      .flatMap((entry) => citationAvailableKinds(citation, entry.style).map((kind) => ({
        style: entry.style,
        kind,
        text: entry?.texts?.[kind] || "",
      })))
      .filter((entry) => entry.text);
  }
  return Object.entries(citation?.render_bundle?.renders || citation?.renders || {})
    .filter(([style]) => !selectedStyle || style === selectedStyle)
    .flatMap(([style, payload]) => citationAvailableKinds(citation, style).map((kind) => ({
      style,
      kind,
      text: payload?.[kind] || "",
    })))
    .filter((entry) => entry.text);
}
