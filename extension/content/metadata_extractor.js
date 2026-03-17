function readMeta(selector, attribute = "content") {
  const node = document.querySelector(selector);
  return node ? (node.getAttribute(attribute) || "").trim() : "";
}

function readJsonLd() {
  const node = document.querySelector('script[type="application/ld+json"]');
  if (!node?.textContent) return {};
  try {
    const parsed = JSON.parse(node.textContent);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    return entry && typeof entry === "object" ? entry : {};
  } catch {
    return {};
  }
}

export function extractPageMetadata() {
  const structured = readJsonLd();
  const canonicalUrl = readMeta('link[rel="canonical"]', "href") || readMeta('meta[property="og:url"]');
  return {
    title: document.title || readMeta('meta[property="og:title"]') || structured.headline || "",
    url: window.location.href,
    canonical_url: canonicalUrl || "",
    author: readMeta('meta[name="author"]') || structured.author?.name || "",
    published_at: readMeta('meta[property="article:published_time"]') || structured.datePublished || "",
    hostname: window.location.hostname || "",
  };
}

