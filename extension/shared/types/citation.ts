export const CITATION_STYLES = Object.freeze(["apa", "mla", "chicago", "harvard"]);
export const CITATION_FORMATS = Object.freeze(["inline", "footnote", "bibliography"]);

export function normalizeCitationStyle(value: any, fallback = "apa") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return CITATION_STYLES.includes(normalized) ? normalized : fallback;
}

export function normalizeCitationFormat(value: any, fallback = "bibliography") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return CITATION_FORMATS.includes(normalized) ? normalized : fallback;
}

export function getLockedCitationStyles(allowedStyles: any) {
  const allowed = Array.isArray(allowedStyles)
    ? allowedStyles
      .map((style) => normalizeCitationStyle(style, ""))
      .filter(Boolean)
    : [];
  if (!allowed.length) {
    return [];
  }
  return CITATION_STYLES.filter((style) => !allowed.includes(style));
}

export function getCitationPreviewText(record: any, style = "apa", format = "bibliography") {
  const normalizedStyle = normalizeCitationStyle(style);
  const normalizedFormat = normalizeCitationFormat(format);
  const styleBundle = record?.render_bundle?.renders?.[normalizedStyle] || record?.renders?.[normalizedStyle] || null;
  if (styleBundle && typeof styleBundle[normalizedFormat] === "string" && styleBundle[normalizedFormat].trim()) {
    return styleBundle[normalizedFormat].trim();
  }
  if (record?.citation?.style === normalizedStyle || record?.style === normalizedStyle) {
    if (normalizedFormat === "inline" && typeof (record?.citation?.inline_citation || record?.inline_citation) === "string") {
      return String(record?.citation?.inline_citation || record?.inline_citation).trim();
    }
    if (normalizedFormat === "footnote" && typeof (record?.citation?.footnote || record?.footnote) === "string") {
      return String(record?.citation?.footnote || record?.footnote).trim();
    }
    if (normalizedFormat === "bibliography") {
      const value = record?.citation?.full_citation || record?.citation?.full_text || record?.full_citation || record?.full_text || "";
      return String(value).trim();
    }
  }
  return "";
}
