document.addEventListener("DOMContentLoaded", function () {

    // -----------------------
    // 🔹 Utilities
    // -----------------------
    const AUTHOR_HINT_SELECTORS = [".author", ".byline", ".article-author", ".post-author", "[rel='author']", "address"];
    const METADATA_SOURCE_CONFIDENCE = { highwire: 0.95, schema: 0.90, jsonld: 0.90, dublin: 0.85, opengraph: 0.75, standard: 0.70, dom: 0.60, url: 0.30 };
    const DOMAIN_INTELLIGENCE = {
      "monitor.co.ug": "newspaper_article", "nytimes.com": "newspaper_article", "medium.com": "blog_post", "substack.com": "blog_post",
      "who.int": "organizational_webpage", "arxiv.org": "preprint", "nature.com": "journal_article", "sciencedirect.com": "journal_article",
      "medrxiv.org": "preprint", "biorxiv.org": "preprint"
    };

    function cleanUrl(rawUrl) {
      try {
        const u = new URL(rawUrl); u.hash = "";
        ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach((p)=>u.searchParams.delete(p));
        return u.toString();
      } catch { return rawUrl; }
    }
    function textValue(value) { return typeof value === "string" ? value.trim() : ""; }
    function readMeta(name, attr = "name") { return textValue(document.querySelector(`meta[${attr}="${name}"]`)?.content); }

    function parseDateBits(value) {
      const raw = textValue(value);
      if (!raw) return null;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        const year = raw.match(/\b(19|20)\d{2}\b/)?.[0] || "n.d.";
        return { raw, year };
      }
      return {
        raw, iso: parsed.toISOString(), year: String(parsed.getUTCFullYear()), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate(),
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
        const [lastName, firstName] = normalized.split(",").map((v)=>v.trim());
        const initials = (firstName || "").split(/\s+/).filter(Boolean).map((x)=>x[0]?.toUpperCase()).join(".");
        return { fullName: `${firstName} ${lastName}`.trim(), firstName, lastName, initials, isOrganization: false };
      }
      if (/\b(editorial|staff|team|inc\.?|corp\.?|organization|agency|ministry|department|university|office|world health organization|united nations)\b/i.test(normalized)) {
        return { fullName: normalized, firstName: "", lastName: normalized, initials: "", isOrganization: true };
      }
      const parts = normalized.split(/\s+/).filter(Boolean);
      const firstName = parts.slice(0, -1).join(" ") || parts[0] || "";
      const lastName = parts.length > 1 ? parts[parts.length - 1] : firstName;
      const initials = firstName.split(/\s+/).filter(Boolean).map((x)=>x[0]?.toUpperCase()).join(".");
      return { fullName: normalized, firstName, lastName, initials, isOrganization: false };
    }

    function deriveSiteNameFromDomain(url) {
      try {
        const host = new URL(url).hostname.replace(/^www\./i, "");
        return host.split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (c)=>c.toUpperCase());
      } catch { return "Unknown source"; }
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
          nodes.push(...entries.filter((entry)=>entry && typeof entry === "object"));
        } catch {}
      }
      return nodes;
    }

    function sourceField(candidates) { return candidates.sort((a,b)=>b.confidence-a.confidence)[0]?.value || ""; }

    function getParagraphNumber() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      while (node && node.nodeType !== 1) node = node.parentNode;
      const para = node?.closest("p");
      if (!para) return null;
      const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'));
      const index = paragraphs.indexOf(para);
      return index >= 0 ? index + 1 : null;
    }

    function classifySource(meta) {
      const domain = (()=>{ try { return new URL(meta.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
      const schemaType = (meta.articleType || "").toLowerCase();
      if (schemaType.includes("newsarticle") || schemaType.includes("news") || DOMAIN_INTELLIGENCE[domain] === "newspaper_article") return { source_type: "news_article", confidence: 0.92 };
      if (meta.journalTitle || (meta.doi && (schemaType.includes("scholarly") || DOMAIN_INTELLIGENCE[domain] === "journal_article"))) return { source_type: "journal_article", confidence: 0.94 };
      if (["arxiv.org", "medrxiv.org", "biorxiv.org"].some((d)=>domain.endsWith(d))) return { source_type: "preprint", confidence: 0.95 };
      if (domain.endsWith(".gov")) return { source_type: "government_document", confidence: 0.88 };
      if (schemaType.includes("blog") || DOMAIN_INTELLIGENCE[domain] === "blog_post") return { source_type: "blog_post", confidence: 0.85 };
      return { source_type: "general_webpage", confidence: 0.45 };
    }

    function titleCase(text) { const value = textValue(text); return value ? value.replace(/\w\S*/g, (w)=>w[0].toUpperCase() + w.slice(1).toLowerCase()) : "Untitled page"; }
    function sentenceCase(text) { const value = textValue(text); return value ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : "Untitled page"; }

    function getCitationMetadata(selectionText, sourceUrl) {
      const canonicalUrl = textValue(document.querySelector('link[rel="canonical"]')?.href);
      const url = cleanUrl(canonicalUrl || sourceUrl || window.location.href);
      const now = new Date();
      const nodes = parseJsonLdBlocks();
      const schemaNode = nodes.find((n)=>/(NewsArticle|ScholarlyArticle|BlogPosting|Report|WebPage|Article)/i.test(String(n["@type"] || ""))) || {};

      const highwireAuthors = Array.from(document.querySelectorAll('meta[name="citation_author"]')).map((m)=>textValue(m.content)).filter(Boolean);
      const schemaAuthors = (Array.isArray(schemaNode.author) ? schemaNode.author : [schemaNode.author]).map((a)=>typeof a === "string" ? a : a?.name).filter(Boolean);
      const bylineAuthor = AUTHOR_HINT_SELECTORS.map((sel)=>textValue(document.querySelector(sel)?.textContent)).find(Boolean);

      const title = sourceField([
        { value: readMeta("citation_title"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
        { value: textValue(schemaNode.headline || schemaNode.name), confidence: METADATA_SOURCE_CONFIDENCE.schema },
        { value: readMeta("og:title", "property"), confidence: METADATA_SOURCE_CONFIDENCE.opengraph },
        { value: readMeta("DC.title"), confidence: METADATA_SOURCE_CONFIDENCE.dublin },
        { value: textValue(document.title), confidence: METADATA_SOURCE_CONFIDENCE.standard },
      ].filter((c)=>c.value));
      const subtitle = sourceField([
        { value: readMeta("citation_subtitle"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
        { value: textValue(schemaNode.alternativeHeadline), confidence: METADATA_SOURCE_CONFIDENCE.schema },
      ].filter((c)=>c.value));

      const authorNames = [...highwireAuthors, ...schemaAuthors, readMeta("author"), readMeta("article:author", "property"), bylineAuthor]
        .flatMap((name)=>String(name || "").split(/,|\band\b|&/i)).map((v)=>v.trim()).filter(Boolean);

      const datePublished = sourceField([
        { value: readMeta("citation_publication_date"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
        { value: textValue(schemaNode.datePublished || schemaNode.dateCreated), confidence: METADATA_SOURCE_CONFIDENCE.schema },
        { value: readMeta("DC.date"), confidence: METADATA_SOURCE_CONFIDENCE.dublin },
        { value: readMeta("article:published_time", "property"), confidence: METADATA_SOURCE_CONFIDENCE.opengraph },
        { value: textValue(document.querySelector("time")?.getAttribute("datetime")), confidence: METADATA_SOURCE_CONFIDENCE.standard },
        { value: readMeta("last-modified"), confidence: METADATA_SOURCE_CONFIDENCE.standard },
      ].filter((c)=>c.value));

      const siteName = sourceField([
        { value: readMeta("citation_journal_title"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
        { value: textValue(schemaNode.isPartOf?.name || schemaNode.publisher?.name), confidence: METADATA_SOURCE_CONFIDENCE.schema },
        { value: readMeta("og:site_name", "property"), confidence: METADATA_SOURCE_CONFIDENCE.opengraph },
        { value: deriveSiteNameFromDomain(url), confidence: METADATA_SOURCE_CONFIDENCE.url },
      ].filter((c)=>c.value));

      const publisher = sourceField([
        { value: readMeta("citation_publisher"), confidence: METADATA_SOURCE_CONFIDENCE.highwire },
        { value: textValue(schemaNode.publisher?.name), confidence: METADATA_SOURCE_CONFIDENCE.schema },
        { value: readMeta("publisher"), confidence: METADATA_SOURCE_CONFIDENCE.standard },
      ].filter((c)=>c.value));

      const authors = Array.from(new Set(authorNames)).map(toAuthorObject).filter(Boolean);
      const mergedTitle = subtitle ? `${title}: ${subtitle}` : title;
      const parsedPublished = parseDateBits(datePublished);
      const metadata = {
        title: mergedTitle || "Untitled Page",
        title_case: titleCase(mergedTitle || "Untitled Page"),
        sentence_case: sentenceCase(mergedTitle || "Untitled Page"),
        subtitle,
        author: authors[0]?.fullName || "",
        authors,
        siteName,
        publisher,
        journalTitle: readMeta("citation_journal_title") || textValue(schemaNode.isPartOf?.name),
        volume: readMeta("citation_volume"),
        issue: readMeta("citation_issue"),
        doi: readMeta("citation_doi") || textValue(schemaNode.identifier?.value),
        articleType: textValue(schemaNode["@type"] || ""),
        articleSection: readMeta("citation_section") || textValue(schemaNode.articleSection),
        datePublished: parsedPublished?.iso || datePublished || "",
        dateModified: textValue(schemaNode.dateModified || readMeta("article:modified_time", "property")),
        dateAccessed: now.toISOString(),
        url,
        canonicalUrl: url,
        paragraph: getParagraphNumber() || null,
        selectionText,
        excerpt: (selectionText || "").slice(0, 140),
      };
      metadata.classification = classifySource(metadata);
      return metadata;
    }

    function validateCitationMetadata(meta) {
      const fallbackSite = deriveSiteNameFromDomain(meta.url || window.location.href);
      const authors = (meta.authors || []).length ? meta.authors : [toAuthorObject(meta.author || meta.publisher || meta.siteName || fallbackSite)].filter(Boolean);
      return {
        ...meta,
        title: textValue(meta.title) || "Untitled Page",
        title_case: titleCase(meta.title || "Untitled Page"),
        sentence_case: sentenceCase(meta.title || "Untitled Page"),
        siteName: textValue(meta.siteName) || fallbackSite,
        publisher: textValue(meta.publisher) || textValue(meta.siteName) || fallbackSite,
        author: textValue(meta.author) || authors[0]?.fullName || fallbackSite,
        authors,
        datePublished: textValue(meta.datePublished || meta.dateModified),
        classification: meta.classification || classifySource(meta),
      };
    }

    function formatAuthorsForStyle(authors, style) {
      const list = (authors || []).filter(Boolean);
      if (!list.length) return "";
      const formatted = list.map((author) => {
        if (author.isOrganization) return author.fullName;
        if (style === "apa" || style === "harvard") {
          const initials = (author.initials || "").split(".").filter(Boolean).map((i) => `${i}.`).join(" ");
          return `${author.lastName}, ${initials}`.trim();
        }
        return `${author.lastName}, ${author.firstName}`.trim().replace(/,\s*$/, "");
      });
      if (formatted.length === 1) return formatted[0];
      if (style === "mla") return formatted.length === 2 ? `${formatted[0]}, and ${formatted[1]}` : `${formatted[0]}, et al.`;
      if (style === "apa" || style === "harvard") return formatted.length === 2 ? `${formatted[0]} & ${formatted[1]}` : `${formatted[0]} et al.`;
      return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
    }

    function formatQuoteInText(style, meta) {
      if (!meta.selectionText) return "";
      const lead = meta.authors?.[0] || toAuthorObject(meta.author) || toAuthorObject(meta.publisher) || toAuthorObject(meta.siteName);
      const name = lead?.lastName || lead?.fullName || meta.siteName || "Source";
      const year = parseDateBits(meta.datePublished)?.year || "n.d.";
      const para = meta.paragraph;
      if (style === "mla") return `

“${meta.selectionText}” (${name}${para ? `, par. ${para}` : ""})`;
      if (style === "chicago") return para ? `

“${meta.selectionText}” (${name}, para. ${para})` : `

“${meta.selectionText}” (${name})`;
      return `

“${meta.selectionText}” (${name}, ${year}${para ? `, para. ${para}` : ""})`;
    }

    function formatCitation(format, metadata) {
      const meta = validateCitationMetadata(metadata);
      const published = parseDateBits(meta.datePublished || meta.dateModified);
      const authorText = formatAuthorsForStyle(meta.authors, format) || meta.publisher || meta.siteName;
      const year = published?.year || "n.d.";
      const accessed = parseDateBits(meta.dateAccessed)?.long || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const titleText = (format === "apa" || format === "harvard") ? meta.sentence_case : meta.title_case;

      if (meta.classification?.source_type === "journal_article" && meta.doi) {
        const journalBit = [meta.journalTitle || meta.siteName, meta.volume, meta.issue ? `(${meta.issue})` : ""].filter(Boolean).join(" ");
        return `${authorText}. (${year}). ${titleText}. ${journalBit}. https://doi.org/${meta.doi.replace(/^https?:\/\/doi.org\//, "")}.${formatQuoteInText(format, meta)}`;
      }

      switch (format) {
        case "apa":
          return `${authorText}. (${year}). ${titleText}. ${meta.siteName}. ${meta.url}.${formatQuoteInText("apa", meta)}`;
        case "chicago":
          return `${authorText}. "${titleText}." ${meta.siteName}. ${published?.chicago ? `Published ${published.chicago}.` : `Accessed ${accessed}.`} ${meta.url}.${formatQuoteInText("chicago", meta)}`;
        case "harvard":
          return `${authorText} (${year}) ${titleText}. ${meta.siteName}. Available at: ${meta.url} (Accessed: ${accessed}).${formatQuoteInText("harvard", meta)}`;
        case "mla":
        default:
          return `${authorText}. "${titleText}." *${meta.siteName}*, ${published?.mla || year}, ${meta.url}. Accessed ${accessed}.${formatQuoteInText("mla", meta)}`;
      }
    }

    function showCitationPopup(text) {
        const metadata = validateCitationMetadata(getCitationMetadata(text, realSourceUrl || window.location.href));

        const mlaCitation = formatCitation("mla", metadata);
        const apaCitation = formatCitation("apa", metadata);
        const chicagoCitation = formatCitation("chicago", metadata);
        const harvardCitation = formatCitation("harvard", metadata);

        const blur = document.createElement("div");
        blur.className = "blurred-bg";
        blur.onclick = () => { blur.remove(); popup.remove(); };

        const popup = document.createElement("div");
        popup.className = "citation-popup";
        popup.innerHTML = `
            <h3>Citations</h3>
            <strong>MLA:</strong><pre id="mla-cite">${mlaCitation}</pre><button class="copy-popup-btn" data-cite-id="mla-cite" data-cite-format="mla">Copy MLA</button><br/><br/>
            <strong>APA:</strong><pre id="apa-cite">${apaCitation}</pre><button class="copy-popup-btn" data-cite-id="apa-cite" data-cite-format="apa">Copy APA</button><br/><br/>
            <strong>Chicago:</strong><pre id="chicago-cite">${chicagoCitation}</pre><button class="copy-popup-btn" data-cite-id="chicago-cite" data-cite-format="chicago">Copy Chicago</button><br/><br/>
            <strong>Harvard:</strong><pre id="harvard-cite">${harvardCitation}</pre><button class="copy-popup-btn" data-cite-id="harvard-cite" data-cite-format="harvard">Copy Harvard</button><br/><br/>
            <strong>Custom (Pro):</strong><input id="custom-cite-name" type="text" placeholder="Custom format name" /><textarea id="custom-cite" rows="4" placeholder="Paste/type your custom citation here"></textarea><button class="copy-popup-btn" data-cite-id="custom-cite" data-cite-format="custom">Copy Custom</button>
        `;

        popup.querySelectorAll('.copy-popup-btn').forEach(btn => {
            btn.addEventListener('click', () => copyCitation(btn.dataset.citeId, btn.dataset.citeFormat, metadata));
        });

        document.body.appendChild(blur);
        document.body.appendChild(popup);
    }

    // -----------------------
    // 🔹 Copy Citation Handler
    // -----------------------
    async function copyCitation(id, format, metadata) {
        const target = document.getElementById(id);
        const customName = document.getElementById("custom-cite-name")?.value || null;
        const normalizedMeta = validateCitationMetadata(metadata || getCitationMetadata(selectedText, realSourceUrl || window.location.href));

        let citationText = "";
        if (format === "custom") citationText = target?.value || "";
        else citationText = formatCitation(format, normalizedMeta);

        try { await navigator.clipboard.writeText(citationText); showToast("Citation copied!"); }
        catch { alert("Copy failed. Please allow clipboard access or try again."); }

        const citationPayload = {
            url: normalizedMeta.url,
            excerpt: normalizedMeta.excerpt || selectedText || "",
            full_text: citationText,
            format: format || "mla",
            metadata: normalizedMeta,
            author: normalizedMeta.author || null,
            site_name: normalizedMeta.siteName || null,
            custom_format_name: format === "custom" ? customName : null,
            custom_format_template: format === "custom" ? citationText : null
        };

        window.parent.postMessage({ type: "copyCitation", citation: citationPayload }, "*");

        setTimeout(() => {
            document.querySelector(".citation-popup")?.remove();
            document.querySelector(".blurred-bg")?.remove();
        }, 1000);
    }

    function showToast(message) {
        const toast = document.createElement("div");
        toast.className = "copied-toast show";
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.classList.remove("show"); toast.remove(); }, 2000);
    }

    // -----------------------
    // 🔹 Receive Original URL from Parent
    // -----------------------
    window.addEventListener("message", event => {
        if (event.data?.originalUrl) realSourceUrl = event.data.originalUrl;
    });

    // -----------------------
    // 🔹 Optional: Internal Link Interception
    // -----------------------
    document.body.addEventListener('click', e => {
        const link = e.target.closest('a');
        if (link && link.href && !link.target && link.href.startsWith('http')) {
            e.preventDefault();
            window.parent.postMessage({ newUrl: link.href }, '*');
        }
    });

});
