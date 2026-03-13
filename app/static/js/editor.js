async function authFetch(input, init) {
  if (window.webUnlockerAuth?.authFetch) return window.webUnlockerAuth.authFetch(input, init);
  return fetch(input, init);
}

async function verifyEditorAccess() {
  try {
    const res = await authFetch("/api/editor/access");
    if (!res.ok) {
      window.location.href = "/auth?next=/editor&reason=session";
      return false;
    }
    const data = await res.json();
    if (!data.is_paid && data.account_type === "anonymous") {
      renderBlockedMessage("Please sign in to use the editor.");
      return false;
    }
    window.__editorAccess = data;
    return true;
  } catch (_error) {
    renderBlockedMessage("Unable to verify access. Please try again.");
    return false;
  }
}

function renderBlockedMessage(message) {
  document.body.innerHTML = "";
  const c = document.createElement("div");
  c.className = "access-blocked";
  c.innerHTML = `<h1>Upgrade Required</h1><p>${message}</p><a class="primary" href="/static/pricing.html">View plans</a>`;
  document.body.appendChild(c);
}

function startEditor() {
  const toast = window.webUnlockerUI?.createToastManager?.();
  const citeTokenPrefix = "〔cite:";
  const citeTokenSuffix = "〕";
  const AUTOSAVE_DEBOUNCE_MS = 2000;
  const OUTLINE_DEBOUNCE_MS = 700;
  const CHECKPOINT_INTERVAL_MS = 4 * 60 * 1000;
  const CHECKPOINT_CHANGE_THRESHOLD = 700;
  const DEFAULT_FONT = "times-new-roman";
  const DEFAULT_SIZE = "12px";
  const DEFAULT_LINE_HEIGHT = "1.15";

  let currentDocId = null;
  let currentCitationIds = [];
  let citationCache = new Map();
  let selectedCitationId = null;
  let autosaveTimer = null;
  let outlineTimer = null;
  let isDirty = false;
  let allDocs = [];
  let allProjects = [];
  let allNotes = [];
  let editingNoteId = null;
  let editingNoteFocusField = "title";
  let editingNoteDraft = null;
  let citationSearchTimer = null;
  let lastCheckpointAt = 0;
  let changedSinceCheckpoint = 0;
  let lastKnownRange = null;
  let noteAttachContext = null;
  const citationRenderCache = new Map();

  const saveStatus = document.getElementById("save-status");
  const docTitleInput = document.getElementById("doc-title");
  const docsList = document.getElementById("docs-list");
  const projectsList = document.getElementById("projects-list");
  const notesList = document.getElementById("notes-list");
  const docSearchInput = document.getElementById("doc-search");
  const projectSearchInput = document.getElementById("project-search");
  const exportBtn = document.getElementById("export-btn");
  const exportModal = document.getElementById("export-modal");
  const exportHtml = document.getElementById("export-html");
  const exportText = document.getElementById("export-text");
  const exportBibliography = document.getElementById("export-bibliography");
  const exportStyle = document.getElementById("export-style");
  const outlineList = document.getElementById("outline-list");
  const outlinePanel = document.getElementById("outline-panel");
  const historyPanel = document.getElementById("history-panel");
  const historyList = document.getElementById("history-list");
  const freeQuotaBanner = document.getElementById("free-doc-quota");
  const freeQuotaText = document.getElementById("free-doc-quota-text");
  const proBadge = document.getElementById("pro-unlimited-badge");
  const editorWordCount = document.getElementById("editor-word-count");
  const toolWordCount = document.getElementById("tool-word-count");
  const docNotesList = document.getElementById("doc-notes-list");
  const noteModal = document.getElementById("note-modal");
  const quickNoteTitle = document.getElementById("quick-note-title");
  const quickNoteBody = document.getElementById("quick-note-body");
  const quickNoteTags = document.getElementById("quick-note-tags");
  const quickNoteProject = document.getElementById("quick-note-project");
  const researchNotesList = document.getElementById("research-notes-list");
  const researchNotesSearch = document.getElementById("research-notes-search");
  const statusWordCount = document.getElementById("status-word-count");
  const statusCharCount = document.getElementById("status-char-count");
  const statusReadingTime = document.getElementById("status-reading-time");
  const statusPageEstimate = document.getElementById("status-page-estimate");
  const editorToolbar = document.getElementById("editor-toolbar");
  const focusModeBtn = document.getElementById("tool-focus-mode");
  const typewriterBtn = document.getElementById("tool-typewriter");
  const toggleToolbarBtn = document.getElementById("tool-toggle-toolbar");
  const attachNoteModal = document.getElementById("attach-note-modal");
  const attachNoteSearch = document.getElementById("attach-note-search");
  const attachNoteList = document.getElementById("attach-note-list");
  const attachNoteLibraryView = document.getElementById("attach-note-library-view");
  const attachNoteCreateView = document.getElementById("attach-note-create-view");
  const attachNoteTitle = document.getElementById("attach-note-title");
  const attachNoteBody = document.getElementById("attach-note-body");

  function attachButtonClickMotion() {
    document.addEventListener("pointerdown", (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      btn.classList.add("is-clicked");
    });

    const clearClickState = (event) => {
      const btn = event.target.closest("button");
      if (!btn) return;
      btn.classList.remove("is-clicked");
    };

    document.addEventListener("pointerup", clearClickState);
    document.addEventListener("pointercancel", clearClickState);
    document.addEventListener("pointerleave", clearClickState, true);
  }

  attachButtonClickMotion();

  const Font = Quill.import("formats/font");
  Font.whitelist = ["times-new-roman", "georgia", "garamond", "cambria", "arial"];
  Quill.register(Font, true);

  const Size = Quill.import("attributors/style/size");
  Size.whitelist = ["10px", "11px", "12px", "14px", "16px", "18px", "24px"];
  Quill.register(Size, true);

  const Parchment = Quill.import("parchment");
  const LineHeightStyle = new Parchment.Attributor.Style("lineheight", "line-height", {
    scope: Parchment.Scope.BLOCK,
    whitelist: ["1", "1.15", "1.5", "2"],
  });
  Quill.register(LineHeightStyle, true);

  const quill = new Quill("#editor", {
    theme: "snow",
    modules: {
      toolbar: {
        container: "#editor-toolbar",
        handlers: {
          cite: () => insertCitationToken(),
          insertQuickCite: () => insertCitationToken(),
          insertBibliography: () => insertBibliographySection(),
          insertQuote: () => insertCitationQuote(),
        },
      },
      history: { delay: 1200, maxStack: 300, userOnly: true },
      clipboard: { matchVisual: false },
    },
  });

  quill.format("font", DEFAULT_FONT, "silent");
  quill.format("size", DEFAULT_SIZE, "silent");
  quill.format("lineheight", DEFAULT_LINE_HEIGHT, "silent");

  function isProTier() {
    const tier = (window.__editorAccess?.account_type || "").toLowerCase();
    return tier === "pro" || tier === "dev";
  }

  function accountTier() {
    return (window.__editorAccess?.account_type || "free").toLowerCase();
  }

  function allowedFormatsForTier(tier = accountTier()) {
    if (tier === "pro" || tier === "dev") return ["pdf", "docx", "txt", "md", "html"];
    if (tier === "standard") return ["pdf", "docx", "txt", "md", "html"];
    return ["pdf", "html"];
  }

  function normalizeDelta(delta) {
    if (!delta || !Array.isArray(delta.ops)) return { ops: [{ insert: "\n" }] };
    return delta;
  }

  function estimateDeltaLength(delta) {
    if (!delta || !Array.isArray(delta.ops)) return 0;
    return delta.ops.reduce((acc, op) => acc + (typeof op.insert === "string" ? op.insert.length : 1), 0);
  }

  function setSaveStatus(text) { saveStatus.textContent = text; }

  function parseQuickNoteTags(value) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return String(value || "").split(",").map((v) => v.trim()).filter((v) => uuidRegex.test(v));
  }

  function appendTextElement(parent, tagName, text, className = "") {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function placeCursorAtEnd(el) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getEditableText(el) {
    return (el.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function getTextMetrics() {
    const text = (quill.getText() || "").replace(/\s+/g, " ").trim();
    const words = text ? text.split(" ").filter(Boolean) : [];
    const wordCount = words.length;
    const charCount = text.length;
    const readingMinutes = Math.max(0, Math.ceil(wordCount / 225));
    const pages = wordCount / 500;
    return { wordCount, charCount, readingMinutes, pages };
  }

  function updateWordCount() {
    const metrics = getTextMetrics();
    editorWordCount.textContent = `Words: ${metrics.wordCount}`;
    toolWordCount.textContent = `Word Count: ${metrics.wordCount}`;
    if (statusWordCount) statusWordCount.textContent = `Words: ${metrics.wordCount}`;
    if (statusCharCount) statusCharCount.textContent = `Characters: ${metrics.charCount}`;
    if (statusReadingTime) statusReadingTime.textContent = `Reading time: ${metrics.readingMinutes} min`;
    if (statusPageEstimate) statusPageEstimate.textContent = `Pages: ${metrics.pages.toFixed(1)}`;
  }

  async function loadDocNotes() {
    docNotesList.innerHTML = "";
    if (!currentDocId) return;
    const res = await authFetch(`/api/docs/${currentDocId}/notes`);
    if (!res.ok) {
      docNotesList.innerHTML = '<li class="empty-state">Unable to load attached notes.</li>';
      return;
    }
    const links = await res.json();
    if (!links.length) {
      docNotesList.innerHTML = '<li class="empty-state">No notes attached to this document yet.</li>';
      return;
    }
    links.forEach((row) => {
      const note = row.note || {};
      const li = document.createElement("li");
      li.className = "doc-note-item";
      const preview = (note.highlight_text || note.note_body || "").slice(0, 180);
      li.innerHTML = `<strong>${note.title || "Untitled note"}</strong><div>${preview}</div><div class="note-item-footer"><span class="doc-meta">Attached ${new Date(row.attached_at).toLocaleString()}</span></div>`;
      const insertBtn = document.createElement("button");
      insertBtn.className = "pill mini";
      insertBtn.textContent = "Insert";
      insertBtn.addEventListener("click", () => insertNoteIntoEditor(note));
      const del = document.createElement("button");
      del.className = "text note-delete-btn";
      del.textContent = "Detach";
      del.addEventListener("click", async () => {
        const detachRes = await authFetch(`/api/docs/${currentDocId}/notes/${note.id}`, { method: "DELETE" });
        if (!detachRes.ok) return toast?.show({ type: "error", message: "Failed to detach note." });
        await loadDocNotes();
      });
      li.querySelector(".note-item-footer").append(insertBtn, del);
      docNotesList.appendChild(li);
    });
  }

  function addDocNote() {
    openAttachNoteModal();
  }

  function queueAutosave() {
    setSaveStatus("Saving...");
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => autosaveDoc(), AUTOSAVE_DEBOUNCE_MS);
  }

  async function autosaveDoc() {
    if (!currentDocId || !isDirty) return;
    const payload = {
      title: docTitleInput.value.trim() || "Untitled",
      content_delta: quill.getContents(),
      content_html: quill.root.innerHTML,
      citation_ids: currentCitationIds,
    };
    try {
      const res = await authFetch(`/api/docs/${currentDocId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      setSaveStatus("Saved");
      isDirty = false;
      updateDocInList(data);
    } catch (_err) {
      setSaveStatus("Save failed");
      toast?.show({ type: "error", message: "Save failed. Please retry." });
    }
  }

  function renderFreeQuota() {
    if (proBadge) proBadge.classList.toggle("hidden", !isProTier());
    const quota = window.__editorAccess?.doc_quota;
    if (!freeQuotaBanner || !freeQuotaText || !quota || isProTier()) {
      freeQuotaBanner?.classList.add("hidden");
      return;
    }
    freeQuotaBanner.classList.remove("hidden");
    const resetAt = quota.reset_at ? new Date(quota.reset_at).toLocaleString() : "--";
    freeQuotaText.textContent = `${quota.used} / ${quota.limit} documents used in ${quota.period_label || "current period"} · next reset ${resetAt}`;
  }

  async function loadHeaderData() {
    const res = await authFetch("/api/me");
    if (!res.ok) return;
    const data = await res.json();
    const accountType = data.account_type || "free";
    document.getElementById("user-name").textContent = data.name || "User";
    document.getElementById("account-type").textContent = `${accountType[0].toUpperCase()}${accountType.slice(1)}`;
    const quota = window.__editorAccess?.doc_quota || {};
    document.getElementById("usage").textContent = quota.used ?? "--";
    document.getElementById("limit").textContent = quota.limit ?? "--";
    document.getElementById("usage-period").textContent = quota.reset_at ? new Date(quota.reset_at).toLocaleString() : "--";
    const initials = (data.name || "U").split(" ").map((v) => v[0]).join("").slice(0, 2).toUpperCase();
    document.getElementById("avatar-initials").textContent = initials;
  }

  async function loadDocsList() {
    const res = await authFetch("/api/docs");
    if (!res.ok) {
      docsList.innerHTML = "<p>Unable to load documents.</p>";
      return;
    }
    allDocs = await res.json();
    if (window.__editorAccess?.doc_quota) window.__editorAccess.doc_quota.used = allDocs.filter((d) => !d.archived).length;
    renderDocs(allDocs);
    renderFreeQuota();
  }

  function renderDocs(docs) {
    docsList.innerHTML = "";
    const q = (docSearchInput.value || "").toLowerCase();
    const filtered = docs.filter((d) => d.title.toLowerCase().includes(q));
    if (!filtered.length) { docsList.innerHTML = "<p>No documents found.</p>"; return; }
    filtered.forEach((doc) => {
      const item = document.createElement("div");
      item.className = "doc-item";
      if (doc.id === currentDocId) item.classList.add("active");
      const meta = document.createElement("span");
      meta.className = "doc-meta";
      meta.textContent = `Updated ${new Date(doc.updated_at).toLocaleString()}${doc.archived && !isProTier() ? " · Archived" : ""}`;
      const actions = document.createElement("div");
      actions.className = "doc-actions";
      const formats = new Set((doc.allowed_export_formats || allowedFormatsForTier()).map((f) => (f || "").toLowerCase()));
      ["pdf", "docx", "txt", "md", "html"].forEach((fmt) => {
        const b = document.createElement("button");
        b.className = "secondary";
        b.textContent = fmt.toUpperCase();
        b.disabled = !formats.has(fmt);
        b.addEventListener("click", async (e) => { e.stopPropagation(); if (!b.disabled) await downloadExportFile(doc, fmt); });
        actions.appendChild(b);
      });
      if (isProTier()) {
        const del = document.createElement("button");
        del.className = "text tile-delete-btn";
        del.textContent = "✕";
        del.addEventListener("click", async (e) => { e.stopPropagation(); await deleteDocument(doc.id); });
        actions.appendChild(del);
      }
      item.innerHTML = `<strong>${doc.title}</strong>`;
      item.append(meta, actions);
      item.addEventListener("click", () => openDoc(doc.id));
      docsList.appendChild(item);
    });
  }

  function updateDocInList(doc) {
    if (!doc?.id) return;
    const idx = allDocs.findIndex((d) => d.id === doc.id);
    if (idx >= 0) allDocs[idx] = { ...allDocs[idx], ...doc }; else allDocs.unshift(doc);
    renderDocs(allDocs);
  }

  async function deleteDocument(docId) {
    if (!docId || !isProTier() || !window.confirm("Permanently delete this document?")) return;
    const res = await authFetch(`/api/docs/${docId}`, { method: "DELETE" });
    if (!res.ok) return toast?.show({ type: "error", message: "Failed to delete document." });
    if (currentDocId === docId) {
      currentDocId = null;
      quill.setContents(normalizeDelta({ ops: [{ insert: "\n" }] }), "silent");
      docTitleInput.value = "";
    }
    await loadDocsList();
  }

  async function openDoc(docId) {
    await autosaveDoc();
    const res = await authFetch(`/api/docs/${docId}`);
    if (!res.ok) return false;
    const doc = await res.json();
    currentDocId = doc.id;
    currentCitationIds = doc.citation_ids || [];
    docTitleInput.value = doc.title;
    const readOnly = Boolean(doc.archived);
    quill.enable(!readOnly);
    docTitleInput.readOnly = readOnly;
    if (doc.content_delta?.ops?.length) quill.setContents(normalizeDelta(doc.content_delta), "silent");
    else if (doc.content_html) quill.clipboard.dangerouslyPasteHTML(doc.content_html, "silent");
    else quill.setContents(normalizeDelta(doc.content_delta), "silent");
    isDirty = false;
    changedSinceCheckpoint = 0;
    lastCheckpointAt = Date.now();
    updateWordCount();
    await loadDocNotes();
    await refreshInDocCitations();
    buildAndRenderOutline();
    await loadCheckpoints();
    renderDocs(allDocs);
    return true;
  }

  function buildAndRenderOutline() {
    const lines = quill.getLines();
    const outline = [];
    let index = 0;
    lines.forEach((line) => {
      const text = (line.domNode?.textContent || "").trim();
      const formats = line.formats?.() || {};
      const level = formats.header;
      if (level && text) outline.push({ level, text, index });
      index += (line.length?.() || text.length || 0);
    });
    outlineList.innerHTML = "";
    if (!outline.length) {
      outlineList.innerHTML = '<p class="empty-state">No headings yet. Add Title/H1-H4 to build the outline.</p>';
      return;
    }
    outline.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = `outline-item level-${item.level}`;
      const headingLabel = item.level === 1 ? "Title" : `H${item.level - 1}`;
      btn.textContent = `${headingLabel}: ${item.text}`;
      btn.addEventListener("click", () => { quill.setSelection(item.index, 0, "user"); quill.focus(); });
      outlineList.appendChild(btn);
    });
  }

  function scheduleOutlineBuild() {
    if (outlineTimer) clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => buildAndRenderOutline(), OUTLINE_DEBOUNCE_MS);
  }

  async function loadCheckpoints() {
    if (!currentDocId) return;
    const res = await authFetch(`/api/docs/${currentDocId}/checkpoints?limit=15`);
    if (!res.ok) return (historyList.innerHTML = '<p class="empty-state">History unavailable.</p>');
    renderCheckpoints(await res.json());
  }

  function renderCheckpoints(checkpoints = []) {
    historyList.innerHTML = "";
    if (!checkpoints.length) return (historyList.innerHTML = '<p class="empty-state">No checkpoints yet.</p>');
    checkpoints.forEach((checkpoint) => {
      const row = document.createElement("div");
      row.className = "history-row";
      const label = document.createElement("span");
      label.className = "doc-meta";
      label.textContent = new Date(checkpoint.created_at).toLocaleString();
      const restoreBtn = document.createElement("button");
      restoreBtn.className = "secondary";
      restoreBtn.textContent = "Restore";
      restoreBtn.addEventListener("click", async () => restoreCheckpoint(checkpoint.id));
      row.append(label, restoreBtn);
      historyList.appendChild(row);
    });
  }

  async function createCheckpointIfNeeded(force = false) {
    if (!currentDocId) return;
    const now = Date.now();
    if (!force && now - lastCheckpointAt < CHECKPOINT_INTERVAL_MS && changedSinceCheckpoint < CHECKPOINT_CHANGE_THRESHOLD) return;
    const res = await authFetch(`/api/docs/${currentDocId}/checkpoints`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content_delta: quill.getContents(), content_html: quill.root.innerHTML }),
    });
    if (res.ok) { changedSinceCheckpoint = 0; lastCheckpointAt = now; await loadCheckpoints(); }
  }

  async function restoreCheckpoint(checkpointId) {
    if (!currentDocId || !window.confirm("Restore this checkpoint? Current editor content will be replaced.")) return;
    await createCheckpointIfNeeded(true);
    const res = await authFetch(`/api/docs/${currentDocId}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ checkpoint_id: checkpointId }) });
    if (!res.ok) return;
    const doc = await res.json();
    quill.setContents(normalizeDelta(doc.content_delta), "silent");
    isDirty = false;
    setSaveStatus("Restored");
    updateWordCount();
    buildAndRenderOutline();
    await loadCheckpoints();
  }

  async function fetchCitations({ search = "", limit = 50 } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (search) params.set("search", search);
    const res = await authFetch(`/api/citations?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to load citations");
    const citations = await res.json();
    citations.forEach((c) => citationCache.set(c.id, c));
    return citations;
  }

  async function fetchCitationsByIds(ids = []) {
    if (!ids.length) return [];
    const res = await authFetch(`/api/citations/by_ids?ids=${encodeURIComponent(ids.join(","))}`);
    if (!res.ok) throw new Error("Failed to load citations");
    const citations = await res.json();
    citations.forEach((c) => citationCache.set(c.id, c));
    return citations;
  }

  function formatCitationPreview(citation) {
    let domain = "source";
    try { if (citation.url) domain = new URL(citation.url).hostname; } catch (_e) { domain = citation.url || "source"; }
    return { domain, excerpt: citation.excerpt || "No excerpt available", citedAt: citation.cited_at ? new Date(citation.cited_at).toLocaleDateString() : "" };
  }

  function selectCitationCard(card, citationId) {
    document.querySelectorAll(".citation-card").forEach((n) => n.classList.remove("selected"));
    selectedCitationId = citationId;
    card.classList.add("selected");
  }

  function styleOptions() {
    return ["apa", "mla", "chicago", "harvard"];
  }

  function defaultCitationStyle(citation) {
    const preferred = (citation?.format || "mla").toLowerCase();
    return styleOptions().includes(preferred) ? preferred : "mla";
  }

  function getInsertionIndex() {
    const range = quill.getSelection();
    if (range) {
      lastKnownRange = range;
      return range.index;
    }
    if (lastKnownRange && Number.isFinite(lastKnownRange.index)) {
      quill.focus();
      quill.setSelection(lastKnownRange.index, lastKnownRange.length || 0, "silent");
      lastKnownRange = { index: lastKnownRange.index, length: lastKnownRange.length || 0 };
      return lastKnownRange.index;
    }
    const end = quill.getLength();
    quill.focus();
    quill.setSelection(end, 0, "silent");
    lastKnownRange = { index: end, length: 0 };
    return end;
  }

  async function renderCitationForStyle(citation, style) {
    const normalizedStyle = (style || defaultCitationStyle(citation)).toLowerCase();
    const cacheKey = `${citation.id}:${normalizedStyle}`;
    if (citationRenderCache.has(cacheKey)) return citationRenderCache.get(cacheKey);

    if ((citation.format || "").toLowerCase() === normalizedStyle && citation.inline_citation && citation.full_citation) {
      const sameStyleRender = { inline_citation: citation.inline_citation, full_citation: citation.full_citation };
      citationRenderCache.set(cacheKey, sameStyleRender);
      return sameStyleRender;
    }

    const payload = {
      url: citation.url,
      excerpt: citation.excerpt,
      metadata: citation.metadata || {},
      format: normalizedStyle,
    };
    const res = await authFetch("/api/citations/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { inline_citation: buildInlineCitation(citation), full_citation: citation.full_citation || citation.full_text || "" };
    }
    const rendered = await res.json();
    const output = {
      inline_citation: rendered.inline_citation || buildInlineCitation(citation),
      full_citation: rendered.full_citation || citation.full_citation || citation.full_text || "",
    };
    citationRenderCache.set(cacheKey, output);
    return output;
  }

  function buildCitationCard(citation, { showRemove = false, showAttach = true } = {}) {
    const { domain, excerpt, citedAt } = formatCitationPreview(citation);
    const card = document.createElement("div");
    card.className = "citation-card";
    const meta = citation.format ? `${citation.format.toUpperCase()}${citedAt ? ` · ${citedAt}` : ""}` : citedAt;
    card.innerHTML = `<strong>${domain}</strong><p>${excerpt}</p><span class="doc-meta">${meta || ""}</span>`;
    card.addEventListener("click", () => { selectCitationCard(card, citation.id); if (showRemove) jumpToCitation(citation.id); });

    const controls = document.createElement("div");
    controls.className = "citation-controls";
    const formatSelect = document.createElement("select");
    styleOptions().forEach((style) => {
      const option = document.createElement("option");
      option.value = style;
      option.textContent = style.toUpperCase();
      formatSelect.appendChild(option);
    });
    formatSelect.value = defaultCitationStyle(citation);
    controls.appendChild(formatSelect);

    const actions = document.createElement("div");
    actions.className = "citation-actions";

    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert in-text";
    insertBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await insertCitationToken(citation, formatSelect.value);
    });
    actions.append(insertBtn);

    const insertFullBtn = document.createElement("button");
    insertFullBtn.textContent = "Insert full";
    insertFullBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await insertFullCitation(citation, formatSelect.value);
    });
    actions.append(insertFullBtn);

    if (showAttach) {
      const attachBtn = document.createElement("button");
      attachBtn.textContent = "Attach to doc";
      attachBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        attachCitation(citation.id);
      });
      actions.append(attachBtn);

      const attachNoteBtn = document.createElement("button");
      attachNoteBtn.textContent = "Attach Note";
      attachNoteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAttachNoteModal({ citationId: citation.id });
      });
      actions.append(attachNoteBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "text citation-delete-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = showRemove ? "Remove from doc" : "Delete citation";
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (showRemove) removeCitationFromDoc(citation.id);
      else await deleteCitation(citation.id);
    });
    actions.append(removeBtn);

    card.append(controls, actions);
    return card;
  }

  async function deleteCitation(citationId) {
    const res = await authFetch(`/api/citations/${citationId}`, { method: "DELETE" });
    if (!res.ok) return toast?.show({ type: "error", message: "Failed to delete citation." });
    citationCache.delete(citationId);
    await loadCitationLibrary(document.getElementById("citation-search").value || "");
  }

  async function loadCitationLibrary(search = "") {
    const citations = await fetchCitations({ search, limit: 50 });
    const container = document.getElementById("citations-list");
    container.innerHTML = "";
    citations.forEach((c) => container.appendChild(buildCitationCard(c)));
  }

  async function refreshInDocCitations() {
    if (!currentDocId) return;
    const missing = currentCitationIds.filter((id) => !citationCache.has(id));
    if (missing.length) await fetchCitationsByIds(missing);
    const container = document.getElementById("doc-citations-list");
    container.innerHTML = "";
    const docCitations = Array.from(citationCache.values()).filter((c) => currentCitationIds.includes(c.id));
    if (!docCitations.length) return (container.innerHTML = "<p>No citations attached yet.</p>");
    docCitations.forEach((c) => container.appendChild(buildCitationCard(c, { showRemove: true, showAttach: false })));
  }

  function attachCitation(citationId) {
    if (!currentDocId) return alert("Open a document before attaching citations.");
    if (!currentCitationIds.includes(citationId)) {
      currentCitationIds.push(citationId);
      isDirty = true;
      queueAutosave();
      refreshInDocCitations();
    }
  }

  function removeCitationFromDoc(citationId) {
    currentCitationIds = currentCitationIds.filter((id) => id !== citationId);
    removeCitationTokens(citationId);
    isDirty = true;
    queueAutosave();
    refreshInDocCitations();
  }

  function buildInlineCitation(citationData) {
    if (citationData.inline_citation) return citationData.inline_citation;
    const metadata = citationData.metadata || {};
    const author = metadata.author || metadata.creator || metadata.last_name;
    const year = metadata.year || metadata.published_year || metadata.date;
    const title = metadata.title || citationData.title;
    const { domain } = formatCitationPreview(citationData);
    if (author && year) return `(${author}, ${year})`;
    if (author) return `(${author})`;
    if (title) return `(${title})`;
    return `(${domain})`;
  }

  async function insertBibliographySection() {
    const entries = [];
    for (const id of currentCitationIds) {
      const citation = citationCache.get(id);
      if (!citation) continue;
      const rendered = await renderCitationForStyle(citation, defaultCitationStyle(citation));
      if (rendered.full_citation) entries.push(rendered.full_citation);
    }
    if (!entries.length) return alert("Attach citations to this document to generate a bibliography.");
    const index = getInsertionIndex();
    let text = "\nBibliography\n";
    entries.forEach((entry, i) => { text += `${i + 1}. ${entry}\n`; });
    quill.insertText(index, text, "user");
    quill.setSelection(index + text.length, 0, "silent");
  }

  async function insertCitationToken(citation, style) {
    const citationData = citation || (selectedCitationId ? citationCache.get(selectedCitationId) : null);
    if (!citationData) return alert("Select a citation to insert.");
    const token = `${citeTokenPrefix}${citationData.id}${citeTokenSuffix}`;
    const rendered = await renderCitationForStyle(citationData, style);
    const inText = rendered.inline_citation || buildInlineCitation(citationData);
    const insertIndex = getInsertionIndex();
    quill.insertText(insertIndex, `${inText}${token} `, { background: "#eef4ff" }, "user");
    const nextIndex = insertIndex + inText.length + token.length + 1;
    quill.setSelection(nextIndex, 0, "silent");
    lastKnownRange = { index: nextIndex, length: 0 };
    attachCitation(citationData.id);
  }

  async function insertFullCitation(citation, style) {
    const citationData = citation || (selectedCitationId ? citationCache.get(selectedCitationId) : null);
    if (!citationData) return alert("Select a citation to insert.");
    const rendered = await renderCitationForStyle(citationData, style);
    const fullCitation = (rendered.full_citation || citationData.full_citation || citationData.full_text || "").trim();
    if (!fullCitation) return;
    const insertIndex = getInsertionIndex();
    const needsLeadingBreak = insertIndex > 0 && !quill.getText(insertIndex - 1, 1).match(/\s/);
    const text = `${needsLeadingBreak ? "\n" : ""}${fullCitation}\n`;
    quill.insertText(insertIndex, text, "user");
    const nextIndex = insertIndex + text.length;
    quill.setSelection(nextIndex, 0, "silent");
    lastKnownRange = { index: nextIndex, length: 0 };
    attachCitation(citationData.id);
  }

  async function insertCitationQuote() {
    const citationData = selectedCitationId ? citationCache.get(selectedCitationId) : null;
    if (!citationData) return alert("Select a citation to insert a quote.");
    const quoteText = citationData.excerpt || citationData.full_citation || citationData.full_text || "";
    const token = `${citeTokenPrefix}${citationData.id}${citeTokenSuffix}`;
    const rendered = await renderCitationForStyle(citationData, defaultCitationStyle(citationData));
    const inText = rendered.inline_citation || buildInlineCitation(citationData);
    const idx = getInsertionIndex();
    quill.insertText(idx, `
${quoteText}
${inText}${token}
`, { blockquote: true }, "user");
    const nextIndex = idx + quoteText.length + inText.length + token.length + 3;
    quill.setSelection(nextIndex, 0, "silent");
    lastKnownRange = { index: nextIndex, length: 0 };
    attachCitation(citationData.id);
  }

  function removeCitationTokens(citationId) {
    const token = `${citeTokenPrefix}${citationId}${citeTokenSuffix}`;
    const text = quill.getText();
    let index = text.indexOf(token);
    while (index !== -1) {
      quill.deleteText(index, token.length);
      index = quill.getText().indexOf(token, index);
    }
  }

  function jumpToCitation(citationId) {
    const token = `${citeTokenPrefix}${citationId}${citeTokenSuffix}`;
    const index = quill.getText().indexOf(token);
    if (index !== -1) { quill.setSelection(index, token.length); quill.focus(); }
  }

  async function loadProjects() {
    const res = await authFetch("/api/note-projects");
    if (!res.ok) { projectsList.innerHTML = "<p>Unable to load projects.</p>"; return; }
    allProjects = await res.json();
    renderProjects();
  }

  function renderProjects() {
    projectsList.innerHTML = "";
    const q = (projectSearchInput.value || "").toLowerCase();
    const filtered = allProjects.filter((p) => (p.name || "").toLowerCase().includes(q));
    if (!filtered.length) return (projectsList.innerHTML = "<p>No projects found.</p>");
    filtered.forEach((project) => {
      const row = document.createElement("div");
      row.className = "project-item";
      row.innerHTML = `<strong>${project.name}</strong><span class="doc-meta">Updated ${new Date(project.updated_at).toLocaleString()}</span>`;
      const del = document.createElement("button");
      del.className = "text tile-delete-btn";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        const res = await authFetch(`/api/note-projects/${project.id}`, { method: "DELETE" });
        if (res.ok) await loadProjects();
      });
      row.appendChild(del);
      projectsList.appendChild(row);
    });
  }

  async function createProject() {
    const name = window.prompt("Project name");
    if (!name || !name.trim()) return;
    const res = await authFetch("/api/note-projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
    if (res.ok) await loadProjects();
  }

  async function loadNotes() {
    const params = new URLSearchParams();
    const t = document.getElementById("notes-filter-tag").value.trim();
    const p = document.getElementById("notes-filter-project").value.trim();
    const s = document.getElementById("notes-filter-source").value.trim();
    const textSearch = document.getElementById("notes-filter-search")?.value?.trim() || "";
    const sort = document.getElementById("notes-sort").value;
    if (t) params.set("tag", t);
    if (p) params.set("project", p);
    if (s) params.set("source", s);
    if (textSearch) params.set("search", textSearch);
    params.set("sort", sort);
    const res = await authFetch(`/api/notes?${params.toString()}`);
    if (!res.ok) { notesList.innerHTML = '<li class="empty-state">Unable to load notes.</li>'; return; }
    const payload = await res.json();
    allNotes = Array.isArray(payload) ? payload : (payload?.notes || []);
    renderNotes();
    renderResearchNotes();
  }

  function insertNoteIntoEditor(note) {
    const text = (note?.highlight_text || note?.note_body || "").trim();
    if (!text) return;
    const idx = getInsertionIndex();
    quill.insertText(idx, `${text}
`, "user");
    quill.setSelection(idx + text.length + 1, 0, "silent");
  }

  function setAttachNoteModalView(view) {
    if (!attachNoteLibraryView || !attachNoteCreateView) return;
    attachNoteLibraryView.hidden = view !== "library";
    attachNoteCreateView.hidden = view !== "create";
  }

  function closeAttachNoteModal() {
    attachNoteModal?.setAttribute("aria-hidden", "true");
    noteAttachContext = null;
    setAttachNoteModalView("library");
    if (attachNoteTitle) attachNoteTitle.value = "";
    if (attachNoteBody) attachNoteBody.value = "";
    if (attachNoteSearch) attachNoteSearch.value = "";
  }

  async function attachNoteToCurrentDoc(note, { insertIntoEditor = false } = {}) {
    if (!currentDocId) {
      toast?.show({ type: "error", message: "Open a document before attaching notes." });
      return;
    }
    const res = await authFetch(`/api/docs/${currentDocId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_id: note.id }),
    });
    if (!res.ok) {
      toast?.show({ type: "error", message: "Failed to attach note to document." });
      return;
    }
    await loadDocNotes();
    if (insertIntoEditor) insertNoteIntoEditor(note);
    toast?.show({ type: "success", message: "Note attached to this document." });
  }

  function renderAttachNoteList() {
    if (!attachNoteList) return;
    attachNoteList.innerHTML = "";
    const q = (attachNoteSearch?.value || "").trim().toLowerCase();
    const rows = allNotes.filter((note) => {
      if (note.archived_at) return false;
      const haystack = `${note.title || ""} ${note.highlight_text || ""} ${note.note_body || ""} ${note.source_title || ""}`.toLowerCase();
      return !q || haystack.includes(q);
    }).slice(0, 100);
    if (!rows.length) {
      attachNoteList.innerHTML = '<li class="empty-state">No notes found.</li>';
      return;
    }
    rows.forEach((note) => {
      const item = document.createElement("li");
      item.className = "note-item";
      item.innerHTML = `<strong>${note.title || "Untitled note"}</strong><div class="note-body">${(note.highlight_text || note.note_body || "").slice(0, 140)}</div><div class="doc-meta">${note.source_title || note.source_url || ""}</div>`;
      const actions = document.createElement("div");
      actions.className = "actions";
      const attachBtn = document.createElement("button");
      attachBtn.className = "pill mini";
      attachBtn.textContent = "Attach";
      attachBtn.addEventListener("click", async () => {
        await attachNoteToCurrentDoc(note);
      });
      const attachInsertBtn = document.createElement("button");
      attachInsertBtn.className = "pill mini";
      attachInsertBtn.textContent = "Attach + Insert";
      attachInsertBtn.addEventListener("click", async () => {
        await attachNoteToCurrentDoc(note, { insertIntoEditor: true });
      });
      actions.append(attachBtn, attachInsertBtn);
      item.appendChild(actions);
      attachNoteList.appendChild(item);
    });
  }

  async function openAttachNoteModal(context = null) {
    noteAttachContext = context;
    if (!allNotes.length) await loadNotes();
    setAttachNoteModalView("library");
    renderAttachNoteList();
    attachNoteModal?.setAttribute("aria-hidden", "false");
    queueMicrotask(() => attachNoteSearch?.focus());
  }

  async function createAndAttachNoteFromModal() {
    const noteBody = (attachNoteBody?.value || "").trim();
    const title = (attachNoteTitle?.value || "").trim();
    if (!noteBody) {
      toast?.show({ type: "error", message: "Note body is required." });
      return;
    }
    const payload = {
      note_body: noteBody,
      title: title || null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const createRes = await authFetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!createRes.ok) {
      toast?.show({ type: "error", message: "Failed to create note." });
      return;
    }
    const created = await createRes.json();
    await loadNotes();
    const createdNote = allNotes.find((note) => note.id === created.note_id) || { id: created.note_id, title, note_body: noteBody };
    await attachNoteToCurrentDoc(createdNote);
    closeAttachNoteModal();
  }

  async function ensureProjectId(projectName) {
    const normalized = (projectName || "").trim();
    if (!normalized) return null;
    if (!allProjects.length) await loadProjects();
    const existing = allProjects.find((project) => (project.name || "").trim().toLowerCase() === normalized.toLowerCase());
    if (existing?.id) return existing.id;
    const res = await authFetch("/api/note-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: normalized }),
    });
    if (!res.ok) return null;
    const created = await res.json();
    await loadProjects();
    return created?.id || null;
  }

  function renderNotes() {
    notesList.innerHTML = "";
    if (!allNotes.length) return (notesList.innerHTML = '<li class="empty-state">No notes yet.</li>');
    allNotes.forEach((note) => {
      const li = document.createElement("li");
      li.className = "note-item";
      const projectName = allProjects.find((project) => project.id === note.project_id)?.name || "—";
      const isEditing = editingNoteId === note.id;
      if (isEditing) {
        li.classList.add("note-editing");
        editingNoteDraft ||= {
          title: note.title || "",
          highlight_text: note.highlight_text || "",
          note_body: note.note_body || "",
          project: projectName === "—" ? "" : projectName,
        };
      }

      if (isEditing) {
        const editControls = document.createElement("div");
        editControls.className = "note-edit-controls";

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "pill mini pill-primary";
        saveBtn.textContent = "✓ Save";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "pill mini";
        cancelBtn.textContent = "✕ Cancel";

        editControls.append(saveBtn, cancelBtn);
        li.appendChild(editControls);

        const titleEl = document.createElement("strong");
        titleEl.className = "note-title note-editable";
        titleEl.contentEditable = "true";
        titleEl.textContent = editingNoteDraft.title || "Untitled note";
        li.appendChild(titleEl);

        const highlightEl = appendTextElement(li, "div", editingNoteDraft.highlight_text, "note-highlight note-editable");
        highlightEl.contentEditable = "true";

        const bodyEl = appendTextElement(li, "div", editingNoteDraft.note_body, "note-body note-editable");
        bodyEl.contentEditable = "true";

        const projectWrap = document.createElement("label");
        projectWrap.className = "note-project-input";
        projectWrap.textContent = "Project";
        const projectInput = document.createElement("input");
        projectInput.type = "text";
        projectInput.value = editingNoteDraft.project || "";
        projectInput.placeholder = "No project";
        projectWrap.appendChild(projectInput);
        li.appendChild(projectWrap);

        titleEl.addEventListener("input", () => { editingNoteDraft.title = getEditableText(titleEl); });
        highlightEl.addEventListener("input", () => { editingNoteDraft.highlight_text = getEditableText(highlightEl); });
        bodyEl.addEventListener("input", () => { editingNoteDraft.note_body = getEditableText(bodyEl); });
        projectInput.addEventListener("input", () => { editingNoteDraft.project = projectInput.value.trim(); });

        saveBtn.addEventListener("click", async () => {
          const projectId = await ensureProjectId(editingNoteDraft.project);
          await authFetch("/api/notes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: note.id,
              title: (editingNoteDraft.title || "").trim() || null,
              highlight_text: (editingNoteDraft.highlight_text || "").trim() || null,
              note_body: (editingNoteDraft.note_body || "").trim() || null,
              project_id: projectId,
              updated_at: new Date().toISOString(),
            }),
          });
          editingNoteId = null;
          editingNoteDraft = null;
          await loadNotes();
        });

        cancelBtn.addEventListener("click", async () => {
          editingNoteId = null;
          editingNoteDraft = null;
          await loadNotes();
        });

        const focusTarget = editingNoteFocusField === "project" ? projectInput : titleEl;
        queueMicrotask(() => {
          focusTarget.focus();
          if (focusTarget instanceof HTMLElement && focusTarget.isContentEditable) placeCursorAtEnd(focusTarget);
        });
      } else {
        const titleEl = document.createElement("strong");
        titleEl.className = "note-title";
        titleEl.textContent = note.title || "Untitled note";
        li.appendChild(titleEl);
        appendTextElement(li, "div", note.highlight_text ? `“${note.highlight_text.slice(0, 130)}”` : "", "note-highlight");
        appendTextElement(li, "div", note.note_body?.slice(0, 180) || "", "note-body");
      }

      const badgesRow = document.createElement("div");
      badgesRow.className = "meta-row";
      appendTextElement(badgesRow, "span", projectName, "badge");
      li.appendChild(badgesRow);

      const metaRow = document.createElement("div");
      metaRow.className = "meta-row";
      if (note.source_url) {
        const sourceLink = document.createElement("a");
        sourceLink.className = "note-source-link";
        sourceLink.href = note.source_url;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = note.source_url;
        metaRow.appendChild(sourceLink);
      } else {
        appendTextElement(metaRow, "span", "No source");
      }
      appendTextElement(metaRow, "span", new Date(note.updated_at || note.created_at).toLocaleString());
      li.appendChild(metaRow);

      if (!isEditing) {
        const actions = document.createElement("div");
        actions.className = "note-actions";
        [
          { action: "edit", label: "Edit" },
          { action: "assign", label: "Assign Project" },
          { action: "insert", label: "Insert" },
          { action: "cite", label: "Convert to Citation" },
          { action: note.archived_at ? "restore" : "archive", label: note.archived_at ? "Restore" : "Archive" },
          { action: "delete", label: "Delete" },
        ].forEach(({ action, label }) => {
          const button = document.createElement("button");
          button.className = "pill mini";
          button.dataset.action = action;
          button.type = "button";
          button.textContent = label;
          actions.appendChild(button);
        });
        li.appendChild(actions);

        li.addEventListener("click", async (event) => {
          const btn = event.target;
          if (!(btn instanceof HTMLElement) || !btn.dataset.action) return;
          if (btn.dataset.action === "delete") {
            await authFetch(`/api/notes/${note.id}`, { method: "DELETE" });
            await loadNotes();
            return;
          }
          if (btn.dataset.action === "insert") {
            insertNoteIntoEditor(note);
            return;
          }
          if (btn.dataset.action === "cite") {
            const res = await authFetch(`/api/notes/${note.id}/citation`, { method: "POST" });
            if (!res.ok) {
              toast?.show({ type: "error", message: "Failed to convert note to citation." });
              return;
            }
            const data = await res.json();
            if (data?.citation_id) {
              attachCitation(data.citation_id);
              await fetchCitationsByIds([data.citation_id]);
              await loadCitationLibrary(document.getElementById("citation-search").value || "");
              await loadNotes();
              toast?.show({ type: "success", message: data.created ? "Citation created from note." : "Existing citation linked." });
            }
            return;
          }
          if (btn.dataset.action === "archive" || btn.dataset.action === "restore") {
            const endpoint = btn.dataset.action === "archive" ? "archive" : "restore";
            const res = await authFetch(`/api/notes/${note.id}/${endpoint}`, { method: "POST" });
            if (!res.ok) return toast?.show({ type: "error", message: `Failed to ${endpoint} note.` });
            await loadNotes();
            return;
          }
          if (btn.dataset.action === "edit" || btn.dataset.action === "assign") {
            editingNoteId = note.id;
            editingNoteFocusField = btn.dataset.action === "assign" ? "project" : "title";
            editingNoteDraft = {
              title: note.title || "",
              highlight_text: note.highlight_text || "",
              note_body: note.note_body || "",
              project: projectName === "—" ? "" : projectName,
            };
            await loadNotes();
          }
        });
      }
      notesList.appendChild(li);
    });
  }


  function renderResearchNotes() {
    if (!researchNotesList) return;
    researchNotesList.innerHTML = "";
    const q = (researchNotesSearch?.value || "").trim().toLowerCase();
    const docProjectIds = new Set(allNotes.filter((n) => n.project_id).map((n) => n.project_id));
    const rows = allNotes.filter((note) => {
      if (note.archived_at) return false;
      const text = `${note.title || ""} ${note.highlight_text || ""} ${note.note_body || ""} ${note.source_title || ""}`.toLowerCase();
      const match = !q || text.includes(q);
      const projectMatch = !currentDocId || !docProjectIds.size || docProjectIds.has(note.project_id);
      return match && projectMatch;
    }).slice(0, 80);
    if (!rows.length) {
      researchNotesList.innerHTML = '<li class="empty-state">No research notes found.</li>';
      return;
    }
    rows.forEach((note) => {
      const li = document.createElement("li");
      li.className = "note-item";
      appendTextElement(li, "strong", note.title || "Untitled note", "note-title");
      appendTextElement(li, "div", note.highlight_text ? `“${note.highlight_text.slice(0, 120)}”` : (note.note_body || "").slice(0, 120), "note-body");
      const actions = document.createElement("div");
      actions.className = "note-actions";
      const insertBtn = document.createElement("button");
      insertBtn.className = "pill mini";
      insertBtn.textContent = "Insert";
      insertBtn.addEventListener("click", () => {
        insertNoteIntoEditor(note);
      });
      actions.appendChild(insertBtn);
      li.appendChild(actions);
      researchNotesList.appendChild(li);
    });
  }

  function clearQuickNoteForm() {
    quickNoteTitle.value = "";
    quickNoteBody.value = "";
    quickNoteTags.value = "";
    quickNoteProject.value = "";
  }

  function formatQuickNote(format) {
    const start = quickNoteBody.selectionStart;
    const end = quickNoteBody.selectionEnd;
    const selected = quickNoteBody.value.slice(start, end) || "text";
    const wrappers = {
      bold: [`**${selected}**`, 2],
      italic: [`*${selected}*`, 1],
      bullet: [`- ${selected}`, 2],
      link: [`[${selected}](https://)`, selected.length + 3],
    };
    const [replacement, cursor] = wrappers[format] || [selected, 0];
    quickNoteBody.setRangeText(replacement, start, end, "end");
    quickNoteBody.focus();
    quickNoteBody.selectionStart = quickNoteBody.selectionEnd = start + cursor;
  }

  function openNewNoteModal() {
    noteModal?.setAttribute("aria-hidden", "false");
    queueMicrotask(() => quickNoteTitle?.focus());
  }

  function closeNewNoteModal() {
    noteModal?.setAttribute("aria-hidden", "true");
  }

  async function saveQuickNote() {
    const projectId = await ensureProjectId(quickNoteProject.value.trim());
    const payload = {
      note_body: quickNoteBody.value.trim(),
      title: quickNoteTitle.value.trim() || null,
      tags: parseQuickNoteTags(quickNoteTags.value),
      project_id: projectId,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    if (!payload.note_body) {
      toast?.show({ type: "error", message: "Note body is required." });
      return;
    }
    const res = await authFetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      toast?.show({ type: "error", message: "Failed to save note." });
      return;
    }
    clearQuickNoteForm();
    closeNewNoteModal();
    await loadNotes();
  }

  async function createNote() {
    openNewNoteModal();
  }

  function setContentTab(tab) {
    localStorage.setItem("editor_left_content_tab", tab);
    document.querySelectorAll(".content-pill").forEach((b) => {
      const active = b.dataset.contentTab === tab;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.getElementById("left-tab-documents").classList.toggle("active", tab === "documents");
    document.getElementById("left-tab-projects").classList.toggle("active", tab === "projects");
    document.getElementById("left-tab-notes").classList.toggle("active", tab === "notes");
    if (tab === "notes") loadNotes();
  }

  async function downloadExportFile(doc, format) {
    const res = await authFetch(`/api/docs/${doc.id}/export/file?format=${encodeURIComponent(format)}&style=${encodeURIComponent(exportStyle.value)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(doc?.title || "document").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function toggleFocusMode() {
    document.body.classList.toggle("editor-focus-mode");
    focusModeBtn?.classList.toggle("active", document.body.classList.contains("editor-focus-mode"));
  }

  function toggleTypewriterMode() {
    document.body.classList.toggle("editor-typewriter-mode");
    typewriterBtn?.classList.toggle("active", document.body.classList.contains("editor-typewriter-mode"));
  }

  function toggleToolbarVisibility() {
    editorToolbar?.classList.toggle("toolbar-hidden");
    const hidden = editorToolbar?.classList.contains("toolbar-hidden");
    if (toggleToolbarBtn) toggleToolbarBtn.textContent = hidden ? "Show Toolbar" : "Hide Toolbar";
  }

  function highlightActiveLine(range) {
    document.querySelectorAll(".ql-editor .is-active-paragraph").forEach((node) => node.classList.remove("is-active-paragraph"));
    if (!range) return;
    const [line] = quill.getLine(range.index);
    line?.domNode?.classList?.add("is-active-paragraph");
  }

  quill.on("text-change", (delta, _old, source) => {
    if (source !== "user") return;
    isDirty = true;
    changedSinceCheckpoint += estimateDeltaLength(delta);
    queueAutosave();
    scheduleOutlineBuild();
    createCheckpointIfNeeded();
    updateWordCount();
  });
  quill.on("selection-change", (range, oldRange) => {
    if (range) lastKnownRange = range;
    highlightActiveLine(range);
    if (!range && oldRange && isDirty) autosaveDoc();
  });
  docTitleInput.addEventListener("input", () => { isDirty = true; queueAutosave(); });
  window.addEventListener("beforeunload", () => { if (isDirty) autosaveDoc(); });

  docSearchInput.addEventListener("input", () => renderDocs(allDocs));
  projectSearchInput.addEventListener("input", () => renderProjects());
  document.getElementById("new-doc-btn").addEventListener("click", async () => {
    await autosaveDoc();
    const res = await authFetch("/api/docs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) return;
    const doc = await res.json();
    await loadDocsList();
    await openDoc(doc.id);
  });
  document.getElementById("new-project-btn").addEventListener("click", createProject);
  document.getElementById("new-note-btn").addEventListener("click", createNote);
  document.getElementById("save-quick-note")?.addEventListener("click", saveQuickNote);
  document.getElementById("cancel-quick-note")?.addEventListener("click", () => {
    clearQuickNoteForm();
    closeNewNoteModal();
  });
  document.getElementById("close-note-modal")?.addEventListener("click", closeNewNoteModal);
  document.querySelectorAll("#note-modal .format-toolbar [data-format]").forEach((btn) => btn.addEventListener("click", () => formatQuickNote(btn.dataset.format)));
  document.getElementById("close-attach-note-modal")?.addEventListener("click", closeAttachNoteModal);
  document.getElementById("attach-note-open-create")?.addEventListener("click", () => {
    setAttachNoteModalView("create");
    queueMicrotask(() => attachNoteTitle?.focus());
  });
  document.getElementById("attach-note-cancel-create")?.addEventListener("click", () => setAttachNoteModalView("library"));
  document.getElementById("attach-note-save")?.addEventListener("click", createAndAttachNoteFromModal);
  attachNoteSearch?.addEventListener("input", renderAttachNoteList);
  window.addEventListener("click", (event) => {
    if (event.target === noteModal) closeNewNoteModal();
    if (event.target === attachNoteModal) closeAttachNoteModal();
  });

  ["notes-filter-tag", "notes-filter-project", "notes-filter-source", "notes-filter-search", "notes-sort"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => loadNotes());
  });

  document.getElementById("outline-refresh").addEventListener("click", buildAndRenderOutline);
  document.getElementById("history-refresh").addEventListener("click", loadCheckpoints);
  document.getElementById("tool-outline").addEventListener("click", () => outlinePanel.classList.toggle("collapsed"));
  document.getElementById("tool-history").addEventListener("click", () => historyPanel.classList.toggle("collapsed"));
  document.getElementById("tool-add-doc-note").addEventListener("click", addDocNote);
  focusModeBtn?.addEventListener("click", toggleFocusMode);
  typewriterBtn?.addEventListener("click", toggleTypewriterMode);
  toggleToolbarBtn?.addEventListener("click", toggleToolbarVisibility);

  document.getElementById("citation-search").addEventListener("input", (event) => {
    if (citationSearchTimer) clearTimeout(citationSearchTimer);
    const query = event.target.value;
    citationSearchTimer = setTimeout(async () => loadCitationLibrary(query), 250);
  });

  researchNotesSearch?.addEventListener("input", () => renderResearchNotes());

  const tabs = document.querySelectorAll(".tab");
  const panels = { library: document.getElementById("tab-library"), "in-doc": document.getElementById("tab-in-doc"), research: document.getElementById("tab-research") };
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((b) => b.classList.remove("active"));
    tab.classList.add("active");
    Object.values(panels).forEach((p) => p.classList.remove("active"));
    panels[tab.dataset.tab].classList.add("active");
  }));

  document.querySelectorAll(".content-pill").forEach((pill) => pill.addEventListener("click", () => setContentTab(pill.dataset.contentTab)));

  exportBtn.addEventListener("click", async () => {
    if (!currentDocId) return;
    exportModal.setAttribute("aria-hidden", "false");
    const res = await authFetch(`/api/docs/${currentDocId}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style: exportStyle.value, html: quill.root.innerHTML, text: quill.getText() }) });
    if (!res.ok) return;
    const data = await res.json();
    exportHtml.textContent = data.html || "";
    exportText.textContent = data.text || "";
    exportBibliography.innerHTML = "";
    (data.bibliography || []).forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = entry;
      exportBibliography.appendChild(li);
    });
  });
  exportStyle.addEventListener("change", () => exportModal.getAttribute("aria-hidden") === "false" && exportBtn.click());
  document.getElementById("close-export").addEventListener("click", () => exportModal.setAttribute("aria-hidden", "true"));
  window.addEventListener("click", (event) => { if (event.target === exportModal) exportModal.setAttribute("aria-hidden", "true"); });

  (async () => {
    await loadHeaderData();
    await loadDocsList();
    await loadProjects();
    await loadNotes();
    await loadCitationLibrary();
    const defaultTab = localStorage.getItem("editor_left_content_tab") || "documents";
    setContentTab(defaultTab);
    const initialDocId = new URLSearchParams(window.location.search).get("doc");
    let opened = false;
    if (initialDocId) opened = await openDoc(initialDocId);
    if (!opened) {
      if (allDocs.length) await openDoc(allDocs[0].id);
      else document.getElementById("new-doc-btn").click();
    }
  })();
}

(async () => {
  if (await verifyEditorAccess()) startEditor();
})();
