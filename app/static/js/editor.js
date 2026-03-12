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
  let citationSearchTimer = null;
  let lastCheckpointAt = 0;
  let changedSinceCheckpoint = 0;

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

  const quill = new Quill("#editor", {
    theme: "snow",
    modules: {
      toolbar: {
        container: "#editor-toolbar",
        handlers: {
          cite: () => insertCitationToken(),
          insertQuote: () => insertCitationQuote(),
        },
      },
      history: { delay: 1200, maxStack: 300, userOnly: true },
      clipboard: { matchVisual: false },
    },
  });

  function isProTier() {
    const tier = (window.__editorAccess?.account_type || "").toLowerCase();
    return tier === "pro" || tier === "dev";
  }

  function accountTier() {
    return (window.__editorAccess?.account_type || "free").toLowerCase();
  }

  function allowedFormatsForTier(tier = accountTier()) {
    if (tier === "pro" || tier === "dev") return ["pdf", "docx", "txt"];
    if (tier === "standard") return ["pdf", "docx"];
    return ["pdf"];
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

  function getWordCount() {
    const words = (quill.getText() || "").trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  function updateWordCount() {
    const count = getWordCount();
    editorWordCount.textContent = `Words: ${count}`;
    toolWordCount.textContent = `Word Count: ${count}`;
  }

  function getDocNotesStorageKey() {
    return `editor_doc_notes:${currentDocId || "none"}`;
  }

  function loadDocNotes() {
    docNotesList.innerHTML = "";
    if (!currentDocId) return;
    const raw = localStorage.getItem(getDocNotesStorageKey());
    const notes = raw ? JSON.parse(raw) : [];
    if (!notes.length) {
      docNotesList.innerHTML = '<li class="empty-state">No doc notes yet.</li>';
      return;
    }
    notes.forEach((note) => {
      const li = document.createElement("li");
      li.className = "doc-note-item";
      li.innerHTML = `<div>${note.text}</div><div class="note-item-footer"><span class="doc-meta">${new Date(note.created_at).toLocaleString()}</span></div>`;
      const del = document.createElement("button");
      del.className = "text note-delete-btn";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        const next = notes.filter((n) => n.id !== note.id);
        localStorage.setItem(getDocNotesStorageKey(), JSON.stringify(next));
        loadDocNotes();
      });
      li.querySelector(".note-item-footer").appendChild(del);
      docNotesList.appendChild(li);
    });
  }

  function addDocNote() {
    if (!currentDocId) return;
    const text = window.prompt("Add a quick doc note:");
    if (!text || !text.trim()) return;
    const raw = localStorage.getItem(getDocNotesStorageKey());
    const notes = raw ? JSON.parse(raw) : [];
    notes.unshift({ id: crypto.randomUUID(), text: text.trim(), created_at: new Date().toISOString() });
    localStorage.setItem(getDocNotesStorageKey(), JSON.stringify(notes));
    loadDocNotes();
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
      ["pdf", "docx", "txt"].forEach((fmt) => {
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
    loadDocNotes();
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
      outlineList.innerHTML = '<p class="empty-state">No headings yet. Add H1/H2/H3 to build the outline.</p>';
      return;
    }
    outline.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = `outline-item level-${item.level}`;
      btn.textContent = item.text;
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

  function buildCitationCard(citation, { showRemove = false, showAttach = true } = {}) {
    const { domain, excerpt, citedAt } = formatCitationPreview(citation);
    const card = document.createElement("div");
    card.className = "citation-card";
    const meta = citation.format ? `${citation.format.toUpperCase()}${citedAt ? ` · ${citedAt}` : ""}` : citedAt;
    card.innerHTML = `<strong>${domain}</strong><p>${excerpt}</p><span class="doc-meta">${meta || ""}</span>`;
    card.addEventListener("click", () => { selectCitationCard(card, citation.id); if (showRemove) jumpToCitation(citation.id); });

    const actions = document.createElement("div");
    actions.className = "citation-actions";
    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert in-text";
    insertBtn.addEventListener("click", (e) => { e.stopPropagation(); insertCitationToken(citation); });
    actions.append(insertBtn);

    if (showAttach) {
      const attachBtn = document.createElement("button");
      attachBtn.textContent = "Attach to doc";
      attachBtn.addEventListener("click", (e) => { e.stopPropagation(); attachCitation(citation.id); });
      actions.append(attachBtn);
    }

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy full";
    copyBtn.addEventListener("click", async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(citation.full_text || ""); });
    actions.append(copyBtn);

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

    card.appendChild(actions);
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

  function insertCitationToken(citation) {
    let citationData = citation || (selectedCitationId ? citationCache.get(selectedCitationId) : null);
    if (!citationData) return alert("Select a citation to insert.");
    const token = `${citeTokenPrefix}${citationData.id}${citeTokenSuffix}`;
    const inText = buildInlineCitation(citationData);
    const range = quill.getSelection(true);
    const insertIndex = range ? range.index : quill.getLength();
    quill.insertText(insertIndex, `${inText}${token} `, { background: "#eef4ff" }, "user");
    quill.setSelection(insertIndex + inText.length + token.length + 1);
    attachCitation(citationData.id);
  }

  function insertCitationQuote() {
    const citationData = selectedCitationId ? citationCache.get(selectedCitationId) : null;
    if (!citationData) return alert("Select a citation to insert a quote.");
    const quoteText = citationData.excerpt || citationData.full_text || "";
    const token = `${citeTokenPrefix}${citationData.id}${citeTokenSuffix}`;
    const inText = buildInlineCitation(citationData);
    const range = quill.getSelection(true);
    const idx = range ? range.index : quill.getLength();
    quill.insertText(idx, `\n${quoteText}\n${inText}${token}\n`, { blockquote: true }, "user");
    quill.setSelection(idx + quoteText.length + inText.length + token.length + 3);
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
    const sort = document.getElementById("notes-sort").value;
    if (t) params.set("tag", t);
    if (p) params.set("project", p);
    if (s) params.set("source", s);
    params.set("sort", sort);
    const res = await authFetch(`/api/notes?${params.toString()}`);
    if (!res.ok) { notesList.innerHTML = '<li class="empty-state">Unable to load notes.</li>'; return; }
    allNotes = (await res.json()) || [];
    renderNotes();
  }

  function renderNotes() {
    notesList.innerHTML = "";
    if (!allNotes.length) return (notesList.innerHTML = '<li class="empty-state">No notes yet.</li>');
    allNotes.forEach((note) => {
      const li = document.createElement("li");
      li.className = "note-item";
      const title = note.title || note.highlight_text || "Untitled note";
      li.innerHTML = `<strong>${title}</strong><div class="doc-meta">${note.source_domain || "manual"} · ${new Date(note.updated_at).toLocaleString()}</div>`;
      const textarea = document.createElement("textarea");
      textarea.value = note.note_body || "";
      li.appendChild(textarea);
      const footer = document.createElement("div");
      footer.className = "note-item-footer";
      const save = document.createElement("button");
      save.className = "secondary";
      save.textContent = "Save";
      save.addEventListener("click", async () => {
        await authFetch("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, note_body: textarea.value, title: note.title, updated_at: new Date().toISOString() }) });
        await loadNotes();
      });
      const del = document.createElement("button");
      del.className = "text note-delete-btn";
      del.textContent = "✕";
      del.addEventListener("click", async () => { await authFetch(`/api/notes/${note.id}`, { method: "DELETE" }); await loadNotes(); });
      footer.append(save, del);
      li.appendChild(footer);
      notesList.appendChild(li);
    });
  }

  async function createNote() {
    const noteBody = window.prompt("Write note");
    if (!noteBody || !noteBody.trim()) return;
    const payload = { note_body: noteBody.trim(), title: "Editor Note", updated_at: new Date().toISOString(), created_at: new Date().toISOString() };
    const res = await authFetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) await loadNotes();
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

  quill.on("text-change", (delta, _old, source) => {
    if (source !== "user") return;
    isDirty = true;
    changedSinceCheckpoint += estimateDeltaLength(delta);
    queueAutosave();
    scheduleOutlineBuild();
    createCheckpointIfNeeded();
    updateWordCount();
  });
  quill.on("selection-change", (range, oldRange) => { if (!range && oldRange && isDirty) autosaveDoc(); });
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

  ["notes-filter-tag", "notes-filter-project", "notes-filter-source", "notes-sort"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => loadNotes());
  });

  document.getElementById("outline-refresh").addEventListener("click", buildAndRenderOutline);
  document.getElementById("history-refresh").addEventListener("click", loadCheckpoints);
  document.getElementById("tool-outline").addEventListener("click", () => outlinePanel.classList.toggle("collapsed"));
  document.getElementById("tool-history").addEventListener("click", () => historyPanel.classList.toggle("collapsed"));
  document.getElementById("tool-add-doc-note").addEventListener("click", addDocNote);

  document.getElementById("citation-search").addEventListener("input", (event) => {
    if (citationSearchTimer) clearTimeout(citationSearchTimer);
    const query = event.target.value;
    citationSearchTimer = setTimeout(async () => loadCitationLibrary(query), 250);
  });

  const tabs = document.querySelectorAll(".tab");
  const panels = { library: document.getElementById("tab-library"), "in-doc": document.getElementById("tab-in-doc") };
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
