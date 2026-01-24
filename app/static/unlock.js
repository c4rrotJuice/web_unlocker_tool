document.addEventListener("DOMContentLoaded", function () {
    const events = ['contextmenu', 'copy', 'cut', 'selectstart', 'mousedown'];
    events.forEach(event => {
        document.body.addEventListener(event, function(e) {
            e.stopPropagation();
        }, true);
    });

    document.oncontextmenu = null;
    document.onselectstart = null;
    document.oncopy = null;
    document.body.oncontextmenu = null;
    document.body.onselectstart = null;
    document.body.oncopy = null;

    document.body.addEventListener('click', function (e) {
        const link = e.target.closest('a');
        if (link && link.href && !link.target && link.href.startsWith('http')) {
            e.preventDefault();
            window.parent.postMessage({ newUrl: link.href }, '*');
        }
    });

    const style = document.createElement('style');
    style.innerHTML = `
        * { user-select: text !important; }
        .copy-cite-btn {
            position: absolute;
            background: #222;
            color: #fff;
            padding: 5px 10px;
            font-size: 14px;
            border-radius: 5px;
            z-index: 9999;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .citation-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #fff;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
            z-index: 10000;
            width: 90%;
            max-width: 500px;
        }
        .citation-popup h3 { margin-top: 0; font-size: 18px; }
        .citation-popup pre {
            background: #f0f0f0;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
            font-size: 14px;
        }
        .copy-popup-btn {
            background-color: #007bff;
            color: #fff;
            padding: 6px 10px;
            margin-top: 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .blurred-bg {
            position: fixed;
            top: 0; left: 0;
            width: 100vw;
            height: 100vh;
            backdrop-filter: blur(6px);
            background: rgba(0,0,0,0.3);
            z-index: 9999;
        }
        .copied-toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #333;
            color: #fff;
            padding: 10px 15px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 10001;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
        }
        .copied-toast.show { opacity: 1; }
    `;
    document.head.appendChild(style);

    document.addEventListener("mouseup", function (event) {
        const selection = window.getSelection();
        const text = selection.toString().trim();
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
        const btn = document.querySelector(".copy-cite-btn");
        if (btn) btn.remove();
    }

    function showCitationPopup(text) {
        const sourceUrl = realSourceUrl || window.location.href;
        const pageTitle = document.title || "Untitled Page";
        const accessDate = new Date().toISOString().split("T")[0];
        const mlaCitation = `"${text}" — *${pageTitle}*. Accessed ${accessDate}. ${sourceUrl}`;
        const apaCitation = `${pageTitle}. (${accessDate}). Retrieved from ${sourceUrl}\n"${text}"`;
        const chicagoCitation = `${pageTitle}. "${text}." Accessed ${accessDate}. ${sourceUrl}`;
        const harvardCitation = `${pageTitle} (${accessDate}) "${text}", available at: ${sourceUrl}.`;

        const blur = document.createElement("div");
        blur.className = "blurred-bg";
        blur.onclick = () => {
            document.body.removeChild(blur);
            popup.remove();
        };

        const popup = document.createElement("div");
        popup.className = "citation-popup";
        popup.innerHTML = `
            <h3>Citations</h3>
            <strong>MLA:</strong>
            <pre id="mla-cite">${mlaCitation}</pre>
            <button class="copy-popup-btn" data-cite-id="mla-cite" data-cite-format="mla">Copy MLA</button>
            <br/><br/>
            <strong>APA:</strong>
            <pre id="apa-cite">${apaCitation}</pre>
            <button class="copy-popup-btn" data-cite-id="apa-cite" data-cite-format="apa">Copy APA</button>
            <br/><br/>
            <strong>Chicago:</strong>
            <pre id="chicago-cite">${chicagoCitation}</pre>
            <button class="copy-popup-btn" data-cite-id="chicago-cite" data-cite-format="chicago">Copy Chicago</button>
            <br/><br/>
            <strong>Harvard:</strong>
            <pre id="harvard-cite">${harvardCitation}</pre>
            <button class="copy-popup-btn" data-cite-id="harvard-cite" data-cite-format="harvard">Copy Harvard</button>
            <br/><br/>
            <strong>Custom (Pro):</strong>
            <input id="custom-cite-name" type="text" style="width:100%; margin-bottom:8px;" placeholder="Custom format name (e.g., Lab Style)" />
            <textarea id="custom-cite" rows="4" style="width:100%;" placeholder="Paste or type your custom citation format here..."></textarea>
            <button class="copy-popup-btn" data-cite-id="custom-cite" data-cite-format="custom">Copy Custom</button>
        `;

        popup.querySelectorAll('.copy-popup-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                copyCitation(btn.dataset.citeId, btn.dataset.citeFormat);
            });
        });

        document.body.appendChild(blur);
        document.body.appendChild(popup);
    }
    
    
    
let realSourceUrl = null;
let selectedText = "";

// ✅ Listen for original URL from parent
window.addEventListener("message", (event) => {
    if (event.data?.originalUrl) {
        realSourceUrl = event.data.originalUrl;
    }
});

async function copyCitation(id, format) {
    const target = document.getElementById(id);
    const citationText = target?.value || target?.innerText || "";
    const customName = document.getElementById("custom-cite-name")?.value || null;
    const sourceUrl = realSourceUrl || window.location.href;
    const pageTitle = document.title || "Untitled Page";
    const accessDate = new Date().toISOString().split("T")[0];
    const selectedExcerpt = selectedText || citationText;

    try {
        await navigator.clipboard.writeText(citationText);
        showToast("Citation copied!");
    } catch (err) {
        alert("Copy failed. Please allow clipboard access or try again.");
    }

    //Send citation to parent instead of POSTing directly
    const citationPayload = {
        url: sourceUrl,
        excerpt: `${pageTitle}`,
        full_text: citationText,
        format: format || "mla",
        custom_format_name: format === "custom" ? customName : null,
        custom_format_template: format === "custom" ? citationText : null
        // user_id and cited_at handled by backend if needed
    };

    window.parent.postMessage({ type: "copyCitation", citation: citationPayload }, "*");

    // Optional UI cleanup
    setTimeout(() => {
        document.querySelector(".citation-popup")?.remove();
        document.querySelector(".blurred-bg")?.remove();
    }, 1000);
}

/*
    async function copyCitation(id) {
        const citationText = document.getElementById(id).innerText;
        const token = localStorage.getItem("access_token");
        const sourceUrl = realSourceUrl || window.location.href;
        const pageTitle = document.title || "Untitled Page";
        const accessDate = new Date().toISOString().split("T")[0];
        const selectedExcerpt = selectedText || citationText;

        try {
            await navigator.clipboard.writeText(citationText);
            showToast("Citation copied!");
        } catch (err) {
            alert("Copy failed. Please allow clipboard access or try again.");
        }

        try {
            await fetch("/api/citations", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    url: sourceUrl,
                    excerpt: `"${selectedExcerpt}" — ${pageTitle}`,
                    full_text: citationText
                })
            });
        } catch (err) {
            console.error("Failed to save citation:", err);
        }

        setTimeout(() => {
            document.querySelector(".citation-popup")?.remove();
            document.querySelector(".blurred-bg")?.remove();
        }, 1000);
    }*/

    function showToast(message) {
        const toast = document.createElement("div");
        toast.className = "copied-toast show";
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove("show");
            toast.remove();
        }, 2000);
    }

    window.addEventListener("contextmenu", e => e.stopPropagation(), true);
    window.addEventListener("copy", e => e.stopPropagation(), true);
    window.addEventListener("selectstart", e => e.stopPropagation(), true);
});
