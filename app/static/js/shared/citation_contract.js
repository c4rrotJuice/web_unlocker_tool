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

export function citationRenderEntries(citation) {
  const bundleStyles = citation?.render_bundle?.styles;
  if (Array.isArray(bundleStyles) && bundleStyles.length) {
    return bundleStyles.map((entry) => ({
      style: entry.style,
      text: entry?.texts?.bibliography || entry?.texts?.footnote || entry?.texts?.quote_attribution || entry?.texts?.inline || "",
    }));
  }
  const styles = citation?.available_renders?.styles;
  if (Array.isArray(styles) && styles.length) {
    return styles.map((entry) => ({
      style: entry.style,
      text: entry?.texts?.bibliography || entry?.texts?.footnote || entry?.texts?.quote_attribution || entry?.texts?.inline || "",
    }));
  }
  return Object.entries(citation?.render_bundle?.renders || citation?.renders || {}).map(([style, payload]) => ({
    style,
    text: payload?.bibliography || payload?.footnote || payload?.quote_attribution || payload?.inline || "",
  }));
}
