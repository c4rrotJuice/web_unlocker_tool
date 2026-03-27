export function citationPrimaryText(citation, fallback = "Citation saved") {
  return (
    citation?.primary_render?.text
    || citation?.available_renders?.primary?.text
    || citation?.renders?.mla?.bibliography
    || citation?.excerpt
    || citation?.annotation
    || citation?.source?.title
    || fallback
  );
}

export function citationRenderEntries(citation) {
  const styles = citation?.available_renders?.styles;
  if (Array.isArray(styles) && styles.length) {
    return styles.map((entry) => ({
      style: entry.style,
      text: entry?.texts?.bibliography || entry?.texts?.footnote || entry?.texts?.quote_attribution || entry?.texts?.inline || "",
    }));
  }
  return Object.entries(citation?.renders || {}).map(([style, payload]) => ({
    style,
    text: payload?.bibliography || payload?.footnote || payload?.quote_attribution || payload?.inline || "",
  }));
}
