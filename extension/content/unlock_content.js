(() => {
  const DEBUG =
    window.__webUnlockerDebug === true ||
    window.__WEB_UNLOCKER_DEBUG__ === true ||
    window.localStorage?.getItem("webUnlockerDebug") === "1";
  const debug = (...args) => {
    if (DEBUG) {
      console.debug("[Web Unlocker]", ...args);
    }
  };

  if (window.__webUnlockerContentScriptInjected) {
    if (document.documentElement) {
      document.documentElement.dataset.webUnlocker = "1";
    }
    return;
  }
  window.__webUnlockerContentScriptInjected = true;

  const state = {
    selectionText: "",
    lastFormat: "mla",
    lastCitationText: "",
    customFormatName: "",
    customFormatTemplate: "",
    accountType: "anonymous",
  };

  const STYLE_ID = "web-unlocker-extension-style";
  // Guard flag prevents repeated enable toasts on reinjection.
  const ENABLE_TOAST_FLAG = "__WEB_UNLOCKER_ENABLED__";

  let styleInjectQueued = false;
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    if (!document.head) {
      if (!styleInjectQueued) {
        styleInjectQueued = true;
        debug("Styles deferred; document.head not ready yet.");
        document.addEventListener(
          "DOMContentLoaded",
          () => {
            styleInjectQueued = false;
            injectStyles();
          },
          { once: true },
        );
      }
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      * {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
      }

      .web-unlocker-copy-btn {
        position: fixed;
        background: #111827;
        color: #fff;
        padding: 4px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        border-radius: 999px;
        z-index: 2147483647;
        box-shadow: 0 6px 16px rgba(0,0,0,0.25);
        pointer-events: auto;
        display: flex;
        gap: 4px;
      }

      .web-unlocker-inline-action {
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 10px;
        cursor: pointer;
      }

      .web-unlocker-inline-action:hover {
        background: rgba(255,255,255,0.15);
      }

      .web-unlocker-note-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(460px, 92vw);
        background: linear-gradient(145deg, #0f172a, #111827);
        border-radius: 14px;
        border: 1px solid #334155;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
        z-index: 2147483647;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }

      .web-unlocker-note-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 24px;
        font-weight: 300;
        line-height: 1;
      }

      .web-unlocker-note-heading {
        color: #f8fafc;
        font-size: 20px;
        font-weight: 600;
      }

      .web-unlocker-note-highlight {
        border: 1px solid #334155;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.6);
        color: #e2e8f0;
        font-size: 14px;
        line-height: 1.45;
        padding: 10px;
        max-height: 120px;
        overflow: auto;
      }

      .web-unlocker-note-modal textarea,
      .web-unlocker-note-modal input,
      .web-unlocker-note-modal select {
        width: 100%;
        background: rgba(30, 41, 59, 0.9);
        color: #f8fafc;
        border: 1px solid #475569;
        border-radius: 10px;
        padding: 9px;
        font-size: 14px;
      }

      .web-unlocker-note-modal textarea::placeholder,
      .web-unlocker-note-modal input::placeholder {
        color: #94a3b8;
      }

      .web-unlocker-note-modal textarea {
        min-height: 88px;
        resize: vertical;
      }

      .web-unlocker-note-modal button {
        border: 1px solid #475569;
        border-radius: 8px;
        padding: 8px 14px;
        cursor: pointer;
      }

      .web-unlocker-note-modal button.secondary {
        background: transparent;
        color: #e2e8f0;
      }

      .web-unlocker-note-modal button:not(.secondary) {
        background: linear-gradient(180deg, #2563eb, #1d4ed8);
        border-color: #2563eb;
        color: #fff;
      }

      .web-unlocker-backdrop {
        position: fixed;
        inset: 0;
        backdrop-filter: blur(5px);
        background: rgba(0,0,0,0.4);
        z-index: 2147483646;
        pointer-events: auto;
      }

      .web-unlocker-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        z-index: 2147483647;
        width: min(720px, 92vw);
        max-height: 85vh;
        border: 1px solid #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color: #1f2937;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        pointer-events: auto;
      }

      .web-unlocker-popup-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 22px 12px;
        border-bottom: 1px solid #e5e7eb;
      }

      .web-unlocker-popup-header h3 {
        margin: 0;
        font-size: 18px;
      }

      .web-unlocker-popup-close {
        background: transparent;
        border: none;
        font-size: 20px;
        line-height: 1;
        color: #6b7280;
        cursor: pointer;
        padding: 4px 6px;
      }

      .web-unlocker-popup-close:hover {
        color: #111827;
      }

      .web-unlocker-popup-body {
        padding: 16px 22px;
        overflow-y: auto;
        flex: 1 1 auto;
      }

      
      .web-unlocker-row.is-disabled {
        opacity: 0.5;
      }

      .web-unlocker-row.is-disabled .copy-btn {
        cursor: not-allowed;
      }
.web-unlocker-popup pre {
        background: #f8fafc;
        padding: 10px;
        border-radius: 6px;
        overflow-x: auto;
        font-family: "Courier New", Courier, monospace;
        font-size: 13px;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .web-unlocker-popup-body button,
      .web-unlocker-footer button {
        background-color: #3b82f6;
        color: #fff;
        padding: 8px 12px;
        margin-top: 8px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.2s;
      }

      .web-unlocker-popup-body button.secondary,
      .web-unlocker-footer button.secondary {
        background-color: #e5e7eb;
        color: #111827;
      }

      .web-unlocker-popup-body button:hover,
      .web-unlocker-footer button:hover {
        background-color: #2563eb;
      }

      .web-unlocker-popup-body button.secondary:hover,
      .web-unlocker-footer button.secondary:hover {
        background-color: #d1d5db;
      }

      .web-unlocker-row {
        margin-bottom: 16px;
      }

      .web-unlocker-row strong {
        display: block;
        margin-bottom: 6px;
      }

      .web-unlocker-custom input,
      .web-unlocker-custom textarea {
        width: 100%;
        margin-top: 6px;
        padding: 8px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        font-size: 13px;
        font-family: inherit;
      }

      .web-unlocker-custom textarea {
        min-height: 80px;
      }

      .web-unlocker-footer {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        padding: 12px 22px 18px;
        border-top: 1px solid #e5e7eb;
      }

      .web-unlocker-toast {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: #282c34;
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      .web-unlocker-toast.show {
        opacity: 1;
        transform: translate(-50%, -6px);
      }
    `;
    document.head.appendChild(style);
  }

  function enableSelection() {
    const events = ["contextmenu", "copy", "cut", "selectstart", "mousedown"];

    events.forEach((eventName) => {
      window.addEventListener(eventName, (event) => event.stopPropagation(), {
        capture: true,
      });
      document.addEventListener(eventName, (event) => event.stopPropagation(), {
        capture: true,
      });
    });

    document.oncontextmenu = null;
    document.oncopy = null;
    document.onselectstart = null;
    if (document.body) {
      document.body.oncontextmenu = null;
      document.body.oncopy = null;
      document.body.onselectstart = null;
    }
  }

  function showToast(message, isError = false) {
    const root = document.body || document.documentElement;
    if (!root) {
      debug("Toast skipped; no root element available.");
      return;
    }
    const toast = document.createElement("div");
    toast.className = "web-unlocker-toast";
    toast.textContent = message;
    if (isError) {
      toast.style.backgroundColor = "#ef4444";
    }
    root.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function closePopup() {
    document.querySelector(".web-unlocker-popup")?.remove();
    document.querySelector(".web-unlocker-backdrop")?.remove();
    document.removeEventListener("keydown", handleKeydown);
    unlockPageScroll();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      closePopup();
    }
  }

  function sanitizeText(text) {
    return text.replace(/[&<>\"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return map[char] || char;
    });
  }

  /* ===========================
   CITATION METADATA UTILITIES
   =========================== */

  const AUTHOR_HINT_SELECTORS = [
    ".author",
    ".byline",
    ".article-author",
    ".post-author",
    "[rel='author']",
    "address",
  ];

  function cleanUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = "";
      const removeParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
      ];
      removeParams.forEach((p) => u.searchParams.delete(p));
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  function textValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function deriveSiteNameFromDomain(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, "");
      const [first] = hostname.split(".");
      return (first || hostname || "Unknown source")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    } catch {
      return "Unknown source";
    }
  }


  const METADATA_SELECTOR_REGISTRY = {
    highwireTitle: 'meta[name="citation_title"]',
    openGraphTitle: 'meta[property="og:title"]',
    openGraphSiteName: 'meta[property="og:site_name"]',
    metaAuthor: 'meta[name="author"]',
    dublinCoreTitle: 'meta[name="DC.title"]',
    microHeadline: '[itemprop="headline"]',
  };

  const METADATA_SOURCE_CONFIDENCE = {
    highwire: 0.95,
    schema: 0.9,
    jsonld: 0.9,
    dublin: 0.85,
    opengraph: 0.75,
    standard: 0.7,
    dom: 0.6,
    url: 0.3,
  };

  const DOMAIN_INTELLIGENCE = {
    "monitor.co.ug": "newspaper_article",
    "nytimes.com": "newspaper_article",
    "medium.com": "blog_post",
    "substack.com": "blog_post",
    "who.int": "organizational_webpage",
    "arxiv.org": "preprint",
    "nature.com": "journal_article",
    "sciencedirect.com": "journal_article",
    "medrxiv.org": "preprint",
    "biorxiv.org": "preprint",
  };

  const SITE_TRANSLATORS = {
    "arxiv.org": () => ({
      doi: textValue(document.querySelector('meta[name="citation_doi"]')?.content),
      journalTitle: "arXiv",
      articleType: "preprint",
    }),
    "nature.com": () => ({
      journalTitle: textValue(document.querySelector('meta[name="citation_journal_title"]')?.content) || "Nature",
      articleType: "scholarly",
    }),
    "nytimes.com": () => ({ articleType: "news" }),
  };

  function parseDateBits(value) {
    const raw = textValue(value);
    if (!raw) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
      return yearMatch ? { raw, year: yearMatch[0] } : { raw, year: "n.d." };
    }
    return {
      raw,
      iso: parsed.toISOString(),
      year: String(parsed.getUTCFullYear()),
      month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate(),
      short: parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
      long: parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      mla: parsed.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }),
      apa: parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      chicago: parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      harvard: parsed.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }),
    };
  }

  function toAuthorObject(fullName) {
    const normalized = textValue(fullName).replace(/^by\s+/i, "");
    if (!normalized) return null;
    if (normalized.includes(",")) {
      const [lastName, firstName] = normalized.split(",").map((v) => v.trim());
      const initials = firstName?.split(/\s+/).filter(Boolean).map((p) => p[0]?.toUpperCase()).join(".") || "";
      return { firstName, lastName, initials, fullName: `${firstName} ${lastName}`.trim(), isOrganization: false };
    }
    if (/\b(editorial|staff|team|inc\.?|corp\.?|organization|agency|ministry|department|university|office|world health organization|united nations)\b/i.test(normalized)) {
      return { firstName: "", lastName: normalized, initials: "", fullName: normalized, isOrganization: true };
    }
    const parts = normalized.split(/\s+/).filter(Boolean);
    const firstName = parts.slice(0, -1).join(" ") || parts[0] || "";
    const lastName = parts.length > 1 ? parts[parts.length - 1] : firstName;
    const initials = firstName.split(/\s+/).filter(Boolean).map((part) => part[0]?.toUpperCase()).join(".");
    return { firstName, lastName, initials, fullName: normalized, isOrganization: false };
  }

  function titleCase(text) {
    const value = textValue(text);
    if (!value) return "Untitled page";
    return value.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  }

  function sentenceCase(text) {
    const value = textValue(text);
    if (!value) return "Untitled page";
    return `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`;
  }

  function deriveSiteNameFromDomain(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, "");
      return host.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    } catch {
      return "Unknown source";
    }
  }

  function readMeta(name, attr = "name") {
    return textValue(document.querySelector(`meta[${attr}="${name}"]`)?.content);
  }

  function parseJsonLdBlocks() {
    const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const nodes = [];
    for (const block of blocks) {
      const text = textValue(block.textContent);
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed]);
        nodes.push(...entries.filter((entry) => entry && typeof entry === "object"));
      } catch {
        continue;
      }
    }
    return nodes;
  }

  function sourceField(candidates) {
    return candidates.sort((a, b) => b.confidence - a.confidence)[0]?.value || "";
  }

  function getParagraphNumber() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    let node = selection.anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode;
    const paragraph = node?.closest("p");
    if (!paragraph) return null;
    const paragraphs = Array.from(document.querySelectorAll("article p, main p, p"));
    const index = paragraphs.indexOf(paragraph);
    return index >= 0 ? index + 1 : null;
  }

  function classifySource(meta) {
    const domain = (() => {
      try { return new URL(meta.url).hostname.replace(/^www\./, ""); } catch { return ""; }
    })();
    const schemaType = (meta.articleType || "").toLowerCase();
    let source_type = "general_webpage";
    let confidence = 0.45;
    if (schemaType.includes("newsarticle") || schemaType.includes("news") || DOMAIN_INTELLIGENCE[domain] === "newspaper_article") {
      source_type = "newspaper_article"; confidence = 0.92;
    } else if (meta.journalTitle || (meta.doi && (schemaType.includes("scholarly") || DOMAIN_INTELLIGENCE[domain] === "journal_article"))) {
      source_type = "journal_article"; confidence = 0.94;
    } else if (["arxiv.org", "medrxiv.org", "biorxiv.org"].some((d) => domain.endsWith(d))) {
      source_type = "preprint"; confidence = 0.95;
    } else if (domain.endsWith(".gov")) {
      source_type = "government_document"; confidence = 0.88;
    } else if (schemaType.includes("blog") || DOMAIN_INTELLIGENCE[domain] === "blog_post") {
      source_type = "blog_post"; confidence = 0.85;
    }
    return { source_type, confidence };
  }

  function getCitationMetadata(selectionText) {
    const canonical = textValue(document.querySelector('link[rel="canonical"]')?.href);
    const url = cleanUrl(canonical || window.location.href);
    const now = new Date();
    const jsonLdNodes = parseJsonLdBlocks();
    const schemaNode = jsonLdNodes.find((n) => /(NewsArticle|ScholarlyArticle|BlogPosting|Report|WebPage|Article)/i.test(String(n["@type"] || ""))) || {};
    const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const translator = Object.entries(SITE_TRANSLATORS).find(([host]) => domain.endsWith(host))?.[1];
    const translatorData = translator ? translator() : {};

    const highwireAuthors = Array.from(document.querySelectorAll('meta[name="citation_author"]')).map((m) => textValue(m.content)).filter(Boolean);
    const schemaAuthors = (Array.isArray(schemaNode.author) ? schemaNode.author : [schemaNode.author]).map((a) => typeof a === "string" ? a : a?.name).filter(Boolean);
    const bylineAuthor = AUTHOR_HINT_SELECTORS.map((selector) => textValue(document.querySelector(selector)?.textContent)).find(Boolean);

    const title = sourceField([
      { value: readMeta("citation_title"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
      { value: textValue(schemaNode.headline || schemaNode.name), confidence: METADATA_SOURCE_CONFIDENCE.schema },
      { value: readMeta("title", "property"), confidence: METADATA_SOURCE_CONFIDENCE.opengraph },
      { value: readMeta("DC.title"), confidence: METADATA_SOURCE_CONFIDENCE.dublin },
      { value: textValue(document.title), confidence: METADATA_SOURCE_CONFIDENCE.standard },
    ].filter((x) => x.value));

    const subtitle = sourceField([
      { value: readMeta("citation_subtitle"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
      { value: textValue(schemaNode.alternativeHeadline), confidence: METADATA_SOURCE_CONFIDENCE.schema },
    ].filter((x) => x.value));

    const authorNames = [
      ...highwireAuthors,
      ...schemaAuthors,
      textValue(readMeta("author")),
      textValue(readMeta("article:author", "property")),
      bylineAuthor,
    ].flatMap((name) => String(name || "").split(/,|\band\b|&/i)).map((v) => v.trim()).filter(Boolean);

    const publisher = sourceField([
      { value: readMeta("citation_publisher"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
      { value: textValue(schemaNode.publisher?.name), confidence: METADATA_SOURCE_CONFIDENCE.schema },
      { value: readMeta("publisher"), confidence: METADATA_SOURCE_CONFIDENCE.standard },
    ].filter((x) => x.value));

    const siteName = sourceField([
      { value: readMeta("citation_journal_title"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
      { value: textValue(schemaNode.isPartOf?.name || schemaNode.publisher?.name), confidence: METADATA_SOURCE_CONFIDENCE.schema },
      { value: readMeta("og:site_name", "property"), confidence: METADATA_SOURCE_CONFIDENCE.opengraph },
      { value: deriveSiteNameFromDomain(url), confidence: METADATA_SOURCE_CONFIDENCE.url },
    ].filter((x) => x.value));

    const datePublished = sourceField([
      { value: readMeta("citation_publication_date"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
      { value: textValue(schemaNode.datePublished || schemaNode.dateCreated), confidence: METADATA_SOURCE_CONFIDENCE.schema },
      { value: readMeta("DC.date"), confidence: METADATA_SOURCE_CONFIDENCE.dublin },
      { value: readMeta("article:published_time", "property"), confidence: METADATA_SOURCE_CONFIDENCE.opengraph },
      { value: textValue(document.querySelector("time")?.getAttribute("datetime")), confidence: METADATA_SOURCE_CONFIDENCE.standard },
      { value: textValue(document.querySelector('meta[name="last-modified"]')?.content), confidence: METADATA_SOURCE_CONFIDENCE.standard },
    ].filter((x) => x.value));

    const normalizedAuthors = Array.from(new Set(authorNames)).map(toAuthorObject).filter(Boolean);
    const normalizedTitle = subtitle ? `${title}: ${subtitle}` : title;
    const parsedDate = parseDateBits(datePublished);

    const meta = {
      title: normalizedTitle || "Untitled Page",
      title_case: titleCase(normalizedTitle || "Untitled Page"),
      sentence_case: sentenceCase(normalizedTitle || "Untitled Page"),
      subtitle,
      author: normalizedAuthors[0]?.fullName || "",
      authors: normalizedAuthors,
      siteName,
      publisher,
      datePublished: parsedDate?.iso || datePublished || "",
      dateModified: textValue(schemaNode.dateModified || readMeta("article:modified_time", "property")),
      dateAccessed: now.toISOString(),
      articleType: textValue(schemaNode["@type"] || translatorData.articleType || ""),
      articleSection: textValue(readMeta("citation_section") || schemaNode.articleSection),
      journalTitle: textValue(readMeta("citation_journal_title") || translatorData.journalTitle),
      volume: textValue(readMeta("citation_volume")),
      issue: textValue(readMeta("citation_issue")),
      doi: textValue(readMeta("citation_doi") || schemaNode.identifier?.value || translatorData.doi),
      url,
      canonicalUrl: url,
      paragraph: getParagraphNumber() || null,
      selectionText,
      excerpt: (selectionText || "").slice(0, 140),
    };

    meta.classification = classifySource(meta);
    return meta;
  }

  function validateCitationMetadata(meta) {
    const fallbackSite = deriveSiteNameFromDomain(meta.url || window.location.href);
    const normalizedAuthors = (meta.authors || []).length
      ? meta.authors
      : [toAuthorObject(textValue(meta.author) || textValue(meta.publisher) || textValue(meta.siteName) || fallbackSite)].filter(Boolean);
    return {
      ...meta,
      title: textValue(meta.title) || "Untitled Page",
      title_case: titleCase(meta.title || "Untitled Page"),
      sentence_case: sentenceCase(meta.title || "Untitled Page"),
      siteName: textValue(meta.siteName) || fallbackSite,
      publisher: textValue(meta.publisher) || textValue(meta.siteName) || fallbackSite,
      author: textValue(meta.author) || normalizedAuthors[0]?.fullName || fallbackSite,
      datePublished: textValue(meta.datePublished),
      authors: normalizedAuthors,
      classification: meta.classification || classifySource(meta),
    };
  }

  function leadAuthor(meta) {
    return meta.authors?.[0] || toAuthorObject(meta.author) || toAuthorObject(meta.publisher) || toAuthorObject(meta.siteName) || {
      fullName: meta.siteName || "Unknown source",
      firstName: "",
      lastName: meta.siteName || "Unknown source",
      initials: "",
      isOrganization: true,
    };
  }

  function formatAuthorsForStyle(authors, style) {
    const list = (authors || []).filter(Boolean);
    if (!list.length) return "";
    const mapped = list.map((author) => {
      if (author.isOrganization) return author.fullName;
      if (style === "apa" || style === "harvard") {
        const initials = (author.initials || "").split(".").filter(Boolean).map((item) => `${item}.`).join(" ");
        return `${author.lastName}, ${initials}`.trim();
      }
      return `${author.lastName}, ${author.firstName}`.trim().replace(/,\s*$/, "");
    });
    if (mapped.length === 1) return mapped[0];
    if (style === "mla") return mapped.length === 2 ? `${mapped[0]}, and ${mapped[1]}` : `${mapped[0]}, et al.`;
    if (style === "apa" || style === "harvard") return mapped.length === 2 ? `${mapped[0]} & ${mapped[1]}` : `${mapped[0]} et al.`;
    return `${mapped.slice(0, -1).join(", ")}, and ${mapped[mapped.length - 1]}`;
  }

  function formatInTextQuote(style, meta) {
    if (!meta.selectionText) return "";
    const author = leadAuthor(meta);
    const last = author.lastName || author.fullName;
    const year = parseDateBits(meta.datePublished)?.year || "n.d.";
    const para = meta.paragraph;
    if (style === "mla") return `

“${meta.selectionText}” (${last}${para ? `, par. ${para}` : ""})`;
    if (style === "chicago") return para ? `

“${meta.selectionText}” (${last}, para. ${para})` : `

“${meta.selectionText}” (${last})`;
    return `

“${meta.selectionText}” (${last}, ${year}${para ? `, para. ${para}` : ""})`;
  }

  function formatCitation(format, metadata) {
    const meta = validateCitationMetadata(metadata);
    const published = parseDateBits(meta.datePublished || meta.dateModified);
    const accessLong = parseDateBits(meta.dateAccessed)?.long || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const authorText = formatAuthorsForStyle(meta.authors, format) || meta.publisher || meta.siteName || "Unknown source";
    const year = published?.year || "n.d.";
    const titleText = (format === "apa" || format === "harvard") ? meta.sentence_case : meta.title_case;
    const dateText = format === "mla" ? published?.mla : format === "apa" ? published?.apa : format === "chicago" ? published?.chicago : published?.harvard;

    if (meta.classification?.source_type === "journal_article" && meta.doi) {
      const journalBit = [meta.journalTitle || meta.siteName, meta.volume, meta.issue ? `(${meta.issue})` : ""].filter(Boolean).join(" ");
      return `${authorText}. (${year}). ${titleText}. ${journalBit}. https://doi.org/${meta.doi.replace(/^https?:\/\/doi.org\//, "")}.${formatInTextQuote(format, meta)}`;
    }

    switch (format) {
      case "apa":
        return `${authorText}. (${year}). ${titleText}. ${meta.siteName}. ${meta.url}.${formatInTextQuote("apa", meta)}`;
      case "chicago":
        return `${authorText}. "${titleText}." ${meta.siteName}. ${published?.chicago ? `Published ${published.chicago}.` : `Accessed ${accessLong}.`} ${meta.url}.${formatInTextQuote("chicago", meta)}`;
      case "harvard":
        return `${authorText} (${year}) ${titleText}. ${meta.siteName}. Available at: ${meta.url} (Accessed: ${accessLong}).${formatInTextQuote("harvard", meta)}`;
      case "mla":
      default:
        return `${authorText}. "${titleText}." *${meta.siteName}*, ${dateText || year}, ${meta.url}. Accessed ${accessLong}.${formatInTextQuote("mla", meta)}`;
    }
  }

  function formatCustomCitation(template, selectionText, title, url, accessed) {
    if (!template) {
      return "";
    }
    return template
      .replace(/\{title\}/gi, title || "")
      .replace(/\{url\}/gi, url)
      .replace(/\{accessed\}/gi, accessed)
      .replace(/\{quote\}/gi, selectionText);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch (err) {
        document.body.removeChild(textarea);
        return false;
      }
    }
  }

  function sendMessage(type, payload) {
    debug("Sending message", { type });
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) {
          resolve({ error: "Extension context invalidated." });
          return;
        }
        const message = type.startsWith("NOTE_") || type === "NOTES_LIST"
          ? { type, ...(payload || {}) }
          : { type, payload };
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            debug("Message error", chrome.runtime.lastError.message);
            resolve({ error: chrome.runtime.lastError.message });
            return;
          }
          debug("Message response", { type, response });
          resolve(response);
        });
      } catch (error) {
        const message = error?.message || "Extension context invalidated.";
        debug("Message error", message);
        resolve({ error: message });
      }
    });
  }

  async function saveCitation(payload) {
    const response = await sendMessage("SAVE_CITATION", payload);
    if (response?.status === 401 || response?.error === "unauthenticated") {
      showToast("Sign in to save citations.", true);
      return;
    }
    if (response?.status === 403) {
      const message =
        response?.data?.detail?.toast ||
        response?.data?.detail?.message ||
        "Upgrade to unlock this citation format.";
      showToast(message, true);
      return;
    }
    if (response?.error) {
      showToast("Failed to save citation.", true);
      return;
    }
  }

  async function handleCopy(format, citationText, metadata) {
    const copied = await copyText(citationText);
    if (copied) {
      const label = format === "custom" ? "Custom" : format.toUpperCase();
      showToast(`Citation copied (${label}).`);
      // Close quickly after a successful copy for a smoother flow.
      closePopup();
    } else {
      showToast("Copy failed. Please try manually.", true);
    }

    state.lastFormat = format;
    state.lastCitationText = citationText;

    await saveCitation({
      url: metadata.url,
      excerpt: metadata.excerpt,
      full_text: citationText,
      format,
      custom_format_name: metadata.customFormatName || null,
      custom_format_template: metadata.customFormatTemplate || null,
      metadata: {
        source: "extension",
        title: metadata.title,
        author: metadata.author || null,
        site_name: metadata.siteName || null,
        selected_text: metadata.selectionText,
        accessed_at: metadata.accessedAt,
      },
    });
  }

  async function handleWorkInEditor(payload) {
    const response = await sendMessage("WORK_IN_EDITOR", payload);
    if (response?.status === 401 || response?.error === "unauthenticated") {
      showToast("Please sign in to use the editor.", true);
      return;
    }
    if (response?.status === 403 || response?.error === "upgrade_required") {
      showToast("Upgrade required to use the editor.", true);
      return;
    }
    if (response?.status === 429) {
      showToast("Editor usage limit reached.", true);
      return;
    }
    if (response?.data?.allowed === false) {
      showToast(
        response?.data?.toast ||
          "Document limit reached for this period. Upgrade to Pro for unlimited access.",
        true,
      );
      closePopup();
      return;
    }
    if (response?.error) {
      showToast("Unable to open the editor.", true);
      return;
    }
    showToast("Opening editor…");
    closePopup();
  }

  function lockPageScroll() {
    const docEl = document.documentElement;
    const body = document.body;
    if (!docEl || !body) {
      return;
    }
    if (docEl.dataset.webUnlockerScrollLocked === "1") {
      return;
    }
    docEl.dataset.webUnlockerScrollLocked = "1";
    docEl.dataset.webUnlockerPrevOverflow = docEl.style.overflow || "";
    body.dataset.webUnlockerPrevOverflow = body.style.overflow || "";
    // Prevent page scroll while the modal is open.
    docEl.style.overflow = "hidden";
    body.style.overflow = "hidden";
  }

  function unlockPageScroll() {
    const docEl = document.documentElement;
    const body = document.body;
    if (!docEl || !body) {
      return;
    }
    if (docEl.dataset.webUnlockerScrollLocked !== "1") {
      return;
    }
    docEl.style.overflow = docEl.dataset.webUnlockerPrevOverflow || "";
    body.style.overflow = body.dataset.webUnlockerPrevOverflow || "";
    delete docEl.dataset.webUnlockerScrollLocked;
    delete docEl.dataset.webUnlockerPrevOverflow;
    delete body.dataset.webUnlockerPrevOverflow;
  }

  async function buildPopup() {
    closePopup();
    const selectionText = state.selectionText;
    debug("Building popup", { selectionLength: selectionText.length });
    const metadata = validateCitationMetadata(getCitationMetadata(selectionText));
    const url = metadata.url;

    const usagePeek = await sendMessage("peek-unlock", { url });
    state.accountType =
      usagePeek?.data?.account_type || state.accountType || "anonymous";
    const normalizedTier = String(state.accountType || "").toLowerCase();
    const isFreeUser = ["free", "freemium", "anonymous"].includes(
      normalizedTier,
    );
    const isProUser = normalizedTier === "pro";
    const allowedFormats = isFreeUser
      ? new Set(["mla", "apa"])
      : new Set(["mla", "apa", "chicago", "harvard"]);
    const formats = ["mla", "apa", "chicago", "harvard"];
    const popup = document.createElement("div");
    popup.className = "web-unlocker-popup";
    popup.tabIndex = -1;

    const header = document.createElement("div");
    header.className = "web-unlocker-popup-header";

    const headerTitle = document.createElement("h3");
    headerTitle.textContent = "Cite This Selection";
    header.appendChild(headerTitle);

    const headerClose = document.createElement("button");
    headerClose.className = "web-unlocker-popup-close close-popup";
    headerClose.type = "button";
    headerClose.setAttribute("aria-label", "Close citation popup");
    headerClose.textContent = "×";
    header.appendChild(headerClose);

    popup.appendChild(header);

    const body = document.createElement("div");
    body.className = "web-unlocker-popup-body";
    // Scrollable body keeps the popup within the viewport.

    formats.forEach((format) => {
      const label = format.toUpperCase();
      const text = formatCitation(format, metadata);

      const row = document.createElement("div");
      row.className = "web-unlocker-row";
      row.dataset.format = format;

      const titleEl = document.createElement("strong");
      titleEl.textContent = `${label} Format`;
      row.appendChild(titleEl);

      const pre = document.createElement("pre");
      pre.id = `cite-${format}`;
      pre.textContent = text;
      row.appendChild(pre);

      const button = document.createElement("button");
      button.className = "copy-btn";
      button.dataset.format = format;
      button.textContent = `Copy ${label}`;
      const isLocked = !allowedFormats.has(format);
      if (isLocked) {
        row.classList.add("is-disabled");
        button.disabled = true;
        button.textContent = "Locked";
      }
      row.appendChild(button);

      body.appendChild(row);
    });

    const customRow = document.createElement("div");
    customRow.className = "web-unlocker-row web-unlocker-custom";

    const customTitle = document.createElement("strong");
    customTitle.textContent = "Custom (Pro)";
    customRow.appendChild(customTitle);

    const customNameInput = document.createElement("input");
    customNameInput.id = "custom-name";
    customNameInput.type = "text";
    customNameInput.placeholder = "Format name";
    customRow.appendChild(customNameInput);

    const customTemplateInput = document.createElement("textarea");
    customTemplateInput.id = "custom-template";
    customTemplateInput.placeholder =
      "Template (use {title}, {url}, {accessed}, {quote})";
    customRow.appendChild(customTemplateInput);

    const customPreviewEl = document.createElement("pre");
    customPreviewEl.id = "cite-custom";
    customRow.appendChild(customPreviewEl);

    const customButton = document.createElement("button");
    customButton.className = "copy-btn";
    customButton.dataset.format = "custom";
    customButton.textContent = "Copy Custom";
    if (!isProUser) {
      customRow.classList.add("is-disabled");
      customButton.disabled = true;
    }
    customRow.appendChild(customButton);

    body.appendChild(customRow);

    const footer = document.createElement("div");
    footer.className = "web-unlocker-footer";

    const workButton = document.createElement("button");
    workButton.className = "work-in-editor";
    workButton.type = "button";
    workButton.textContent = "Work in editor";
    footer.appendChild(workButton);

    const closeButton = document.createElement("button");
    closeButton.className = "secondary close-popup";
    closeButton.type = "button";
    closeButton.textContent = "Close";
    footer.appendChild(closeButton);

    popup.appendChild(body);
    popup.appendChild(footer);

    const backdrop = document.createElement("div");
    backdrop.className = "web-unlocker-backdrop";
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closePopup();
      }
    });

    popup.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.classList.contains("close-popup")) {
        closePopup();
        return;
      }

      if (target.classList.contains("work-in-editor")) {
        const citationFormat = state.lastFormat || "mla";
        const citationText =
          state.lastCitationText ||
          formatCitation(citationFormat, metadata);
        await handleWorkInEditor({
          url,
          title: metadata.title,
          selected_text: selectionText,
          citation_format: citationFormat,
          citation_text: citationText,
          custom_format_name: state.customFormatName || null,
          custom_format_template: state.customFormatTemplate || null,
        });
        return;
      }

      if (target.classList.contains("copy-btn")) {
        if (target.hasAttribute("disabled")) {
          showToast("Upgrade to unlock this citation format.", true);
          return;
        }
        const format = target.dataset.format || "mla";
        if (format === "custom") {
          const template = customTemplateInput.value.trim();
          const name = customNameInput.value.trim();
          const text = formatCustomCitation(
            template,
            selectionText,
            metadata.title,
            url,
            parseDateBits(metadata.dateAccessed)?.raw || metadata.dateAccessed,
          );
          if (!text) {
            showToast("Add a custom template first.", true);
            return;
          }
          state.customFormatName = name;
          state.customFormatTemplate = template;
          await handleCopy("custom", text, {
            ...metadata,
            customFormatName: name,
            customFormatTemplate: template,
          });
          return;
        }

        const citationPreview = popup.querySelector(`#cite-${format}`);
        const text =
          citationPreview?.textContent ||
          formatCitation(format, metadata);
        await handleCopy(format, text, metadata);
      }
    });

    const root = document.body || document.documentElement;
    if (!root) {
      debug("Popup aborted; no root element available.");
      return;
    }
    root.appendChild(backdrop);
    root.appendChild(popup);
    debug("Popup injected.");
    document.addEventListener("keydown", handleKeydown);
    lockPageScroll();
    popup.focus();

    function updateCustomPreview() {
      const template = customTemplateInput.value.trim();
      const text = formatCustomCitation(
        template,
        selectionText,
        metadata.title,
        url,
        parseDateBits(metadata.dateAccessed)?.raw || metadata.dateAccessed,
      );
      state.customFormatTemplate = template;
      customPreviewEl.textContent = text || "Custom preview";
    }

    customTemplateInput.addEventListener("input", updateCustomPreview);
    customNameInput.addEventListener("input", () => {
      state.customFormatName = customNameInput.value.trim();
    });

    updateCustomPreview();
  }

  let copyButton = null;
  let lastSelectionRect = null;
  let lastSelectionRange = null;
  let ignoreClearUntil = 0;
  let repositionListenersActive = false;

  function closeNoteModal() {
    document.querySelector(".web-unlocker-note-modal")?.remove();
    document.querySelector(".web-unlocker-backdrop")?.remove();
    unlockPageScroll();
  }

  async function openNoteModal() {
    removeCopyButton();
    closeNoteModal();
    const root = document.body || document.documentElement;
    if (!root) return;
    const noteMetadata = validateCitationMetadata(getCitationMetadata(state.selectionText || ""));

    const backdrop = document.createElement("div");
    backdrop.className = "web-unlocker-backdrop";
    backdrop.addEventListener("click", closeNoteModal);

    const modal = document.createElement("div");
    modal.className = "web-unlocker-note-modal";
    modal.innerHTML = `
      <div class="web-unlocker-note-header">
        <strong class="web-unlocker-note-heading">Highlighted Text</strong>
        <button class="secondary" id="wu-note-close" type="button" aria-label="Close note modal">✕</button>
      </div>
      <div class="web-unlocker-note-highlight">${sanitizeText(state.selectionText.slice(0, 600))}</div>
      <textarea id="wu-note-body" rows="4" placeholder="Add a note (optional)..."></textarea>
      <input id="wu-note-tags" type="text" placeholder="Tags (comma separated)" />
      <input id="wu-note-project" type="text" placeholder="Project (optional)" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="secondary" id="wu-note-cancel" type="button">Cancel</button>
        <button id="wu-note-save" type="button">Save</button>
      </div>
    `;
    root.appendChild(backdrop);
    root.appendChild(modal);
    lockPageScroll();

    modal.querySelector("#wu-note-close")?.addEventListener("click", closeNoteModal);
    modal.querySelector("#wu-note-cancel")?.addEventListener("click", closeNoteModal);
    modal.querySelector("#wu-note-save")?.addEventListener("click", async () => {
      const noteBody = modal.querySelector("#wu-note-body")?.value?.trim();
      const response = await sendMessage("NOTE_SAVE", {
        note: {
          title: "",
          highlight_text: state.selectionText,
          note_body: noteBody || state.selectionText,
          source_url: cleanUrl(window.location.href),
          source_title: noteMetadata.title || document.title || null,
          source_author: noteMetadata.author || null,
          source_published_at: noteMetadata.datePublished || null,
          tags: modal.querySelector("#wu-note-tags")?.value || "",
          project: modal.querySelector("#wu-note-project")?.value?.trim() || null,
          timestamp: new Date().toISOString(),
        },
      });
      if (response?.error) {
        showToast("Failed to save note.", true);
        return;
      }
      showToast(response?.data?.sync_blocked ? "Saved locally. Sync paused due to storage cap." : "Note saved.");
      closeNoteModal();
    });
  }

  function createCopyButton() {
    if (copyButton) return copyButton;
    const button = document.createElement("div");
    button.className = "web-unlocker-copy-btn";
    [
      { key: "copy", label: "Copy" },
      { key: "cite", label: "Cite" },
      { key: "note", label: "Note" },
    ].forEach((entry) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "web-unlocker-inline-action";
      action.textContent = entry.label;
      action.addEventListener("pointerdown", async (event) => {
        ignoreClearUntil = Date.now() + 400;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (entry.key === "copy") {
          const copied = await copyText(state.selectionText);
          showToast(copied ? "Copied selection." : "Copy failed.", !copied);
          removeCopyButton();
          return;
        }
        if (entry.key === "cite") {
          removeCopyButton();
          await buildPopup();
          return;
        }
        await openNoteModal();
      }, true);
      button.appendChild(action);
    });
    const root = document.documentElement || document.body;
    if (!root) return null;
    root.appendChild(button);
    copyButton = button;
    return copyButton;
  }

  function getSelectionRect(selection, event) {
    if (!selection || selection.rangeCount === 0) {
      return null;
    }
    try {
      const range = selection.getRangeAt(0);
      let rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        const rects = range.getClientRects();
        rect = rects && rects.length ? rects[0] : rect;
      }
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        const caretRange = range.cloneRange();
        caretRange.collapse(false);
        const caretRects = caretRange.getClientRects();
        rect = caretRects && caretRects.length ? caretRects[0] : rect;
      }
      if (rect) {
        lastSelectionRange = range;
        return rect;
      }
    } catch (error) {
      debug("Selection rect failed", error);
    }
    if (event) {
      return {
        left: event.clientX,
        right: event.clientX,
        top: event.clientY,
        bottom: event.clientY,
        width: 0,
        height: 0,
      };
    }
    return null;
  }

  function positionCopyButton(rect) {
    const button = createCopyButton();
    if (!button || !rect) {
      return;
    }
    const offset = 8;
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    const buttonWidth = button.offsetWidth || 160;
    const buttonHeight = button.offsetHeight || 30;
    const rawLeft = rect.left;
    const rawTop = rect.bottom + offset;
    const maxLeft = Math.max(offset, viewWidth - buttonWidth - offset);
    const maxTop = Math.max(offset, viewHeight - buttonHeight - offset);
    const left = Math.min(Math.max(rawLeft, offset), maxLeft);
    const top = Math.min(Math.max(rawTop, offset), maxTop);
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    const computed = window.getComputedStyle(button);
    debug("Copy button position", {
      left: button.style.left,
      top: button.style.top,
      zIndex: computed.zIndex,
      pointerEvents: computed.pointerEvents,
      rect: button.getBoundingClientRect(),
    });
  }

  function updateCopyButtonPosition() {
    if (!copyButton || !lastSelectionRect) {
      return;
    }
    let rect = lastSelectionRect;
    if (lastSelectionRange) {
      try {
        rect = lastSelectionRange.getBoundingClientRect();
      } catch (error) {
        debug("Selection range rect update failed", error);
      }
    }
    lastSelectionRect = rect;
    positionCopyButton(rect);
  }

  function removeCopyButton() {
    if (copyButton) {
      copyButton.remove();
      copyButton = null;
    }
    lastSelectionRect = null;
    lastSelectionRange = null;
  }

  function ensureRepositionListeners() {
    if (repositionListenersActive) {
      return;
    }
    repositionListenersActive = true;
    const handler = () => updateCopyButtonPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler, true);
  }

  function showCopyButton(rect) {
    lastSelectionRect = rect;
    positionCopyButton(rect);
    ensureRepositionListeners();
  }

  function handleMouseUp(event) {
    if (Date.now() < ignoreClearUntil) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".web-unlocker-popup")) {
      return;
    }
    const selection = window.getSelection();
    const text = selection ? selection.toString().trim() : "";
    debug("Mouseup selection", { length: text.length });
    if (!text) {
      removeCopyButton();
      return;
    }

    state.selectionText = text;
    state.lastCitationText = "";

    const rect = getSelectionRect(selection, event);
    if (!rect) {
      debug("Selection rect missing; skipping button.");
      return;
    }
    debug("Selection rect", rect);
    showCopyButton(rect);
  }

  function handleMouseDown(event) {
    if (Date.now() < ignoreClearUntil) {
      return;
    }
    const target = event.target;
    const inPopup = target instanceof Element && (
      target.closest(".web-unlocker-popup") ||
      target.closest(".web-unlocker-note-modal")
    );
    const isButton = target instanceof Element && (
      target.classList.contains("web-unlocker-copy-btn") ||
      target.closest(".web-unlocker-copy-btn")
    );
    if (!inPopup && !isButton) removeCopyButton();
  }

  debug("Content script init", {
    url: window.location.href,
    top: window.top === window,
    readyState: document.readyState,
    hasBody: Boolean(document.body),
    hasHead: Boolean(document.head),
  });

  injectStyles();
  enableSelection();

  if (document.documentElement) {
    // Marker lets page-context DevTools confirm the script is active.
    document.documentElement.dataset.webUnlocker = "1";
  }

  if (!window[ENABLE_TOAST_FLAG]) {
    window[ENABLE_TOAST_FLAG] = true;
    if (document.body) {
      showToast("Web Unlocker enabled ✓");
    } else {
      debug("Enable toast skipped; body not available yet.");
    }
  }

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousedown", handleMouseDown);

  if (DEBUG) {
    document.addEventListener(
      "pointerdown",
      (event) => {
        const elements = document.elementsFromPoint(
          event.clientX,
          event.clientY,
        );
        debug("Pointerdown elementsFromPoint", elements);
      },
      true,
    );
  }
})();
