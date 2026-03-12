document.addEventListener("DOMContentLoaded", function () {

    // -----------------------
    // 🔹 Utilities
    // -----------------------
    const AUTHOR_HINT_SELECTORS = [".author", ".byline", ".article-author", ".post-author", "[rel='author']", "address"];

    function cleanUrl(rawUrl) {
        try {
            const u = new URL(rawUrl);
            u.hash = "";
            ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach((p)=>u.searchParams.delete(p));
            return u.toString();
        } catch { return rawUrl; }
    }

    function textValue(value) { return typeof value === "string" ? value.trim() : ""; }

    function parseDateBits(value) {
      const raw = textValue(value);
      if (!raw) return null;
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        const year = raw.match(/\b(19|20)\d{2}\b/)?.[0] || "n.d.";
        return { raw, year };
      }
      return {
        raw,
        iso: parsed.toISOString(),
        year: String(parsed.getUTCFullYear()),
        short: parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
        long: parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      };
    }

    function toAuthorObject(fullName) {
      const normalized = textValue(fullName).replace(/^by\s+/i, "");
      if (!normalized) return null;
      if (/\b(editorial|staff|team|inc\.|corp\.|organization|agency|ministry)\b/i.test(normalized)) {
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

    function parseJsonLd() {
      const blocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const block of blocks) {
        const text = textValue(block.textContent);
        if (!text) continue;
        try {
          const parsed = JSON.parse(text);
          const entries = Array.isArray(parsed) ? parsed : (Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed]);
          for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            const authorRaw = Array.isArray(entry.author) ? entry.author : [entry.author];
            const authors = authorRaw.map((a)=> typeof a === 'string' ? a : (a?.name || null)).filter(Boolean);
            return {
              title: textValue(entry.headline || entry.name),
              siteName: textValue(entry.publisher?.name || entry.sourceOrganization?.name),
              publisher: textValue(entry.publisher?.name),
              datePublished: textValue(entry.datePublished || entry.dateCreated),
              section: textValue(entry.articleSection),
              authors,
            };
          }
        } catch {}
      }
      return null;
    }

    function getParagraphNumber() {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        let node = range.startContainer;
        while (node && node.nodeType !== 1) node = node.parentNode;
        const para = node?.closest("p");
        if (!para) return null;
        const paragraphs = Array.from(document.querySelectorAll('p'));
        const index = paragraphs.indexOf(para);
        return index >= 0 ? index + 1 : null;
    }

    function getCitationMetadata(selectionText, sourceUrl) {
      const url = cleanUrl(sourceUrl || window.location.href);
      const now = new Date();
      const jsonLd = parseJsonLd() || {};
      const ogTitle = textValue(document.querySelector('meta[property="og:title"]')?.content);
      const ogSite = textValue(document.querySelector('meta[property="og:site_name"]')?.content);
      const ogAuthor = textValue(document.querySelector('meta[property="article:author"]')?.content);
      const ogPublished = textValue(document.querySelector('meta[property="article:published_time"]')?.content);
      const metaAuthor = textValue(document.querySelector('meta[name="author"]')?.content);
      const metaPublisher = textValue(document.querySelector('meta[name="publisher"]')?.content);
      const metaDate = textValue(document.querySelector('meta[name="date"]')?.content) || textValue(document.querySelector('meta[name="publication_date"]')?.content);
      const article = document.querySelector('article');
      const articleTitle = textValue(article?.querySelector('h1')?.textContent);
      const timeTag = textValue(article?.querySelector('time')?.getAttribute('datetime') || document.querySelector('time')?.getAttribute('datetime'));
      const microTitle = textValue(document.querySelector('[itemprop="headline"]')?.textContent);
      const microAuthor = textValue(document.querySelector('[itemprop="author"]')?.textContent);
      const microPublisher = textValue(document.querySelector('[itemprop="publisher"]')?.textContent);
      const microDate = textValue(document.querySelector('[itemprop="datePublished"]')?.getAttribute('content') || document.querySelector('[itemprop="datePublished"]')?.textContent);
      const heuristicAuthor = AUTHOR_HINT_SELECTORS.map((sel)=>textValue(document.querySelector(sel)?.textContent)).find(Boolean);

      const title = jsonLd.title || ogTitle || microTitle || articleTitle || textValue(document.title) || "Untitled Page";
      const authorsRaw = [ ...(jsonLd.authors || []), ogAuthor, metaAuthor, microAuthor, heuristicAuthor ]
        .filter(Boolean)
        .flatMap((v)=>String(v).split(/,|\band\b|&/i))
        .map((v)=>v.trim())
        .filter(Boolean);
      const authors = Array.from(new Set(authorsRaw)).map(toAuthorObject).filter(Boolean);
      const siteName = jsonLd.siteName || ogSite || metaPublisher || microPublisher || deriveSiteNameFromDomain(url);
      const published = parseDateBits(jsonLd.datePublished || ogPublished || metaDate || timeTag || microDate || "");

      return {
        title,
        author: authors[0]?.fullName || "",
        authors,
        siteName,
        publisher: jsonLd.publisher || metaPublisher || siteName,
        datePublished: published?.iso || published?.raw || "",
        dateAccessed: now.toISOString(),
        url,
        section: jsonLd.section || textValue(document.querySelector('[itemprop="articleSection"]')?.textContent),
        paragraph: getParagraphNumber() || null,
        selectionText,
        excerpt: (selectionText || "").slice(0, 140),
      };
    }

    function validateCitationMetadata(meta) {
      const fallbackSite = deriveSiteNameFromDomain(meta.url || window.location.href);
      return {
        ...meta,
        title: textValue(meta.title) || "Untitled Page",
        siteName: textValue(meta.siteName) || fallbackSite,
        author: textValue(meta.author) || textValue(meta.siteName) || fallbackSite,
        datePublished: textValue(meta.datePublished),
      };
    }
    // -----------------------
    // 🔹 Event & Copy Protections
    // -----------------------
    const events = ['contextmenu', 'copy', 'cut', 'selectstart', 'mousedown'];
    events.forEach(event => {
        document.body.addEventListener(event, e => e.stopPropagation(), true);
    });

    document.oncontextmenu = null;
    document.onselectstart = null;
    document.oncopy = null;
    document.body.oncontextmenu = null;
    document.body.onselectstart = null;
    document.body.oncopy = null;

    window.addEventListener("contextmenu", e => e.stopPropagation(), true);
    window.addEventListener("copy", e => e.stopPropagation(), true);
    window.addEventListener("selectstart", e => e.stopPropagation(), true);

    // -----------------------
    // 🔹 Style Injection
    // -----------------------
    const style = document.createElement("style");
    style.innerHTML = `
        * { user-select: text !important; }
        .copy-cite-btn { position:absolute; background:#222; color:#fff; padding:5px 10px; font-size:14px; border-radius:5px; z-index:9999; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.3); }
        .citation-popup { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:#fff; padding:20px; border-radius:10px; box-shadow:0 8px 20px rgba(0,0,0,0.25); z-index:10000; width:90%; max-width:500px; max-height:85vh; overflow-y:auto; box-sizing:border-box; }
        .citation-popup h3 { margin-top:0; font-size:18px; }
        .citation-popup pre { background:#f0f0f0; padding:10px; border-radius:5px; overflow-x:auto; font-size:14px; white-space:pre-wrap; word-break:break-word; }
        .citation-popup input, .citation-popup textarea { width:100%; box-sizing:border-box; font-size:14px; }
        .copy-popup-btn { background-color:#007bff; color:#fff; padding:6px 10px; margin-top:10px; border:none; border-radius:4px; cursor:pointer; font-size:14px; }
        .blurred-bg { position:fixed; top:0; left:0; width:100vw; height:100vh; backdrop-filter:blur(6px); background:rgba(0,0,0,0.3); z-index:9999; }
        .copied-toast { position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#333; color:#fff; padding:10px 15px; border-radius:6px; font-size:14px; z-index:10001; opacity:0; transition:opacity 0.3s ease-in-out; }
        .copied-toast.show { opacity:1; }
    `;
    document.head.appendChild(style);

    // -----------------------
    // 🔹 Selection & Copy Button
    // -----------------------
    let selectedText = "";
    let realSourceUrl = null;

    document.addEventListener("mouseup", function(event) {
        const text = window.getSelection().toString().trim();
        if (text.length > 0) {
            selectedText = text;
            showCopyButton(event.pageX, event.pageY);
        }
    });

    function showCopyButton(x, y) {
        removeCopyButton();
        const btn = document.createElement("div");
        btn.className = "copy-cite-btn";
        btn.textContent = "📋 Copy + Cite";
        btn.style.top = `${y + 10}px`;
        btn.style.left = `${x + 10}px`;
        btn.onclick = () => {
            removeCopyButton();
            showCitationPopup(selectedText);
        };
        document.body.appendChild(btn);
    }

    function removeCopyButton() {
        document.querySelector(".copy-cite-btn")?.remove();
    }

    // -----------------------
    // 🔹 Citation Formatter
    // -----------------------
    function sentenceCase(text) {
      const value = textValue(text);
      return value ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : "Untitled page";
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
        return author.fullName;
      });
      if (formatted.length === 1) return formatted[0];
      if (style === "mla") return `${formatted[0]}, et al.`;
      if (style === "apa") return formatted.length === 2 ? `${formatted[0]} & ${formatted[1]}` : `${formatted[0]} et al.`;
      return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
    }

    function formatQuoteInText(style, meta) {
      if (!meta.selectionText) return "";
      const lead = meta.authors?.[0] || toAuthorObject(meta.author) || toAuthorObject(meta.siteName);
      const name = lead?.lastName || lead?.fullName || meta.siteName || "Source";
      const year = parseDateBits(meta.datePublished)?.year || "n.d.";
      const para = meta.paragraph;
      if (style === "mla") return `

“${meta.selectionText}” (${name}${para ? `, par. ${para}` : ""})`;
      if (style === "chicago") return para ? `

“${meta.selectionText}” (${name}, para. ${para})` : `

“${meta.selectionText}”`;
      return `

“${meta.selectionText}” (${name}, ${year}${para ? `, para. ${para}` : ""})`;
    }

    function formatCitation(format, metadata) {
        const meta = validateCitationMetadata(metadata);
        const published = parseDateBits(meta.datePublished);
        const authorText = formatAuthorsForStyle(meta.authors, format) || meta.author || meta.siteName;
        const year = published?.year || "n.d.";
        const accessed = parseDateBits(meta.dateAccessed)?.long || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

        switch (format) {
            case "apa":
                return `${authorText}. (${year}). ${sentenceCase(meta.title)}. ${meta.siteName}. ${meta.url}.${formatQuoteInText("apa", meta)}`;
            case "chicago":
                return `${authorText}. "${meta.title}." ${meta.siteName}. ${published?.long ? `Published ${published.long}.` : `Accessed ${accessed}.`} ${meta.url}.${formatQuoteInText("chicago", meta)}`;
            case "harvard":
                return `${authorText} (${year}) ${sentenceCase(meta.title)}. ${meta.siteName}. Available at: ${meta.url} (Accessed: ${accessed}).${formatQuoteInText("harvard", meta)}`;
            case "mla":
            default:
                return `${authorText}. "${meta.title}." *${meta.siteName}*, ${published?.short || year}, ${meta.url}. Accessed ${accessed}.${formatQuoteInText("mla", meta)}`;
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
