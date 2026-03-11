document.addEventListener("DOMContentLoaded", function () {

    // -----------------------
    // 🔹 Utilities
    // -----------------------
    function cleanUrl(rawUrl) {
        try { return new URL(rawUrl).href; } 
        catch { return rawUrl; }
    }

    function getArticleTitle() {
        return document.querySelector('h1')?.innerText || document.title || "Untitled Page";
    }

    function getSiteName() {
        return document.querySelector('meta[property="og:site_name"]')?.content 
            || document.querySelector('meta[name="application-name"]')?.content 
            || window.location.hostname;
    }

    function getAuthor() {
        return document.querySelector('meta[name="author"]')?.content 
            || document.querySelector('meta[property="article:author"]')?.content 
            || null;
    }

    function getParagraphNumber() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        const container = range.startContainer;
        let node = container.nodeType === 3 ? container.parentNode : container;
        let paragraphs = Array.from(document.querySelectorAll('p'));
        const index = paragraphs.indexOf(node);
        return index >= 0 ? index + 1 : null;
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
    function formatCitation(format, selectionText, title, url, accessed, siteName, author) {
        const year = new Date().getFullYear();
        const para = getParagraphNumber();
        const locator = para ? `para. ${para}` : "";
        const quote = selectionText ? `"${selectionText}"` : "";
        const authorText = author || siteName;

        switch (format) {
            case "apa":
                return `${authorText}. (${year}). ${title}. ${url}\n${quote} (${authorText}, ${year}${locator ? `, ${locator}` : ""})`;
            case "chicago":
                return `${quote}\n${authorText}. "${title}." ${siteName}. Accessed ${accessed}. ${url}${locator ? `. ${locator}` : ""}.`;
            case "harvard":
                return `${authorText} (${year}) ${title}. Available at: ${url} (Accessed: ${accessed})${locator ? `, ${locator}` : ""}.\n${quote}`;
            case "mla":
            default:
                return `${quote}\n"${title}." ${siteName}, ${year}, ${url}. Accessed ${accessed}${locator ? `, ${locator}` : ""}.`;
        }
    }

    function showCitationPopup(text) {
        const sourceUrl = cleanUrl(realSourceUrl || window.location.href);
        const pageTitle = getArticleTitle();
        const siteName = getSiteName();
        const author = getAuthor();
        const accessDate = new Date().toISOString().split("T")[0];

        const mlaCitation = formatCitation("mla", text, pageTitle, sourceUrl, accessDate, siteName, author);
        const apaCitation = formatCitation("apa", text, pageTitle, sourceUrl, accessDate, siteName, author);
        const chicagoCitation = formatCitation("chicago", text, pageTitle, sourceUrl, accessDate, siteName, author);
        const harvardCitation = formatCitation("harvard", text, pageTitle, sourceUrl, accessDate, siteName, author);

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
            btn.addEventListener('click', () => copyCitation(btn.dataset.citeId, btn.dataset.citeFormat));
        });

        document.body.appendChild(blur);
        document.body.appendChild(popup);
    }

    // -----------------------
    // 🔹 Copy Citation Handler
    // -----------------------
    async function copyCitation(id, format) {
        const target = document.getElementById(id);
        const customName = document.getElementById("custom-cite-name")?.value || null;
        const sourceUrl = cleanUrl(realSourceUrl || window.location.href);
        const pageTitle = getArticleTitle();
        const siteName = getSiteName();
        const author = getAuthor();
        const accessDate = new Date().toISOString().split("T")[0];

        let citationText = "";
        if (format === "custom") citationText = target?.value || "";
        else citationText = formatCitation(format, selectedText, pageTitle, sourceUrl, accessDate, siteName, author);

        try { await navigator.clipboard.writeText(citationText); showToast("Citation copied!"); }
        catch { alert("Copy failed. Please allow clipboard access or try again."); }

        const citationPayload = {
            url: sourceUrl,
            excerpt: selectedText || "",
            full_text: citationText,
            format: format || "mla",
            author: author || null,
            site_name: siteName || null,
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
