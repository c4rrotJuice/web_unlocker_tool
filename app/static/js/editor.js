async function verifyPaidAccess() {
  try {
    const res = await fetch("/api/editor/access");

    if (!res.ok) {
      window.location.href = "/static/auth.html";
      return false;
    }

    const data = await res.json();
    const isPaid = Boolean(data.is_paid);

    if (!isPaid) {
      renderBlockedMessage("Research Editor is available on paid plans.");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to verify access:", error);
    renderBlockedMessage("Unable to verify access. Please try again.");
    return false;
  }
}

function renderBlockedMessage(message) {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  container.className = "access-blocked";

  const heading = document.createElement("h1");
  heading.textContent = "Upgrade Required";

  const body = document.createElement("p");
  body.textContent = message;

  const link = document.createElement("a");
  link.className = "primary";
  link.href = "/static/pricing.html";
  link.textContent = "View plans";

  container.append(heading, body, link);
  document.body.appendChild(container);
}

function startEditor() {
  const ENABLE_MARKDOWN_SHORTCUTS = true;
  const ENABLE_OUTLINE = true;
  const ENABLE_CHECKPOINTS = true;
  const AUTOSAVE_DEBOUNCE_MS = 2000;
  const OUTLINE_DEBOUNCE_MS = 700;
  const CHECKPOINT_INTERVAL_MS = 4 * 60 * 1000;
  const CHECKPOINT_CHANGE_THRESHOLD = 700;

  // Implementation map:
  // - Doc CRUD uses GET/POST/PUT /api/docs and GET /api/docs/{id} with { title, content_delta, content_html?, citation_ids }.
  // - Autosave updates happen in queueAutosave -> autosaveDoc using PUT /api/docs/{id}.
  // - Citations flow uses /api/citations and /api/citations/by_ids, inserts as text token `〔cite:{id}〕`.
  // - Checkpoints are additive via GET/POST /api/docs/{id}/checkpoints and POST /api/docs/{id}/restore.

  const citeTokenPrefix = "〔cite:";
  const citeTokenSuffix = "〕";
  const markdownState = {
    inProgress: false,
  };

  let currentDocId = null;
  let currentCitationIds = [];
  let citationCache = new Map();
  let selectedCitationId = null;
  let autosaveTimer = null;
  let outlineTimer = null;
  let isDirty = false;
  let allDocs = [];
  let citationSearchTimer = null;
  let lastCheckpointAt = 0;
  let changedSinceCheckpoint = 0;

  const saveStatus = document.getElementById("save-status");
  const docTitleInput = document.getElementById("doc-title");
  const docsList = document.getElementById("docs-list");
  const docSearchInput = document.getElementById("doc-search");
  const exportBtn = document.getElementById("export-btn");
  const exportModal = document.getElementById("export-modal");
  const exportHtml = document.getElementById("export-html");
  const exportText = document.getElementById("export-text");
  const exportBibliography = document.getElementById("export-bibliography");
  const exportStyle = document.getElementById("export-style");
  const outlineList = document.getElementById("outline-list");
  const outlinePanel = document.getElementById("outline-panel");
  const outlineRefreshBtn = document.getElementById("outline-refresh");
  const outlineToggleBtn = document.getElementById("outline-toggle");
  const historyList = document.getElementById("history-list");
  const historyRefreshBtn = document.getElementById("history-refresh");

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
      clipboard: {
        matchVisual: false,
      },
    },
  });

  const Delta = Quill.import("delta");
  quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node, delta) => {
    const allowed = new Set([
      "bold",
      "italic",
      "underline",
      "strike",
      "link",
      "header",
      "list",
      "blockquote",
      "code",
      "code-block",
    ]);

    const cleanedOps = delta.ops.map((op) => {
      if (!op.attributes) return op;
      const attributes = {};
      for (const [key, value] of Object.entries(op.attributes)) {
        if (allowed.has(key)) {
          attributes[key] = value;
        }
      }
      return { ...op, attributes: Object.keys(attributes).length ? attributes : undefined };
    });

    return new Delta(cleanedOps);
  });

  quill.on("text-change", (delta, old, source) => {
    if (ENABLE_MARKDOWN_SHORTCUTS && source === "user") {
      applyMarkdownShortcuts();
    }
    isDirty = true;
    changedSinceCheckpoint += estimateDeltaLength(delta);
    queueAutosave();
    scheduleOutlineBuild();
    if (ENABLE_CHECKPOINTS) {
      createCheckpointIfNeeded();
    }
  });

  quill.on("selection-change", (range, oldRange) => {
    if (!range && oldRange && isDirty) {
      autosaveDoc();
    }
  });

  docTitleInput.addEventListener("input", () => {
    isDirty = true;
    queueAutosave();
  });

  window.addEventListener("beforeunload", () => {
    if (isDirty) {
      autosaveDoc();
    }
  });

  function setSaveStatus(text) {
    saveStatus.textContent = text;
  }

  function normalizeDelta(delta) {
    if (!delta || !Array.isArray(delta.ops)) {
      return { ops: [{ insert: "\n" }] };
    }
    return delta;
  }

  function estimateDeltaLength(delta) {
    if (!delta || !Array.isArray(delta.ops)) return 0;
    return delta.ops.reduce((acc, op) => {
      if (typeof op.insert === "string") return acc + op.insert.length;
      return acc + 1;
    }, 0);
  }

  function queueAutosave() {
    setSaveStatus("Saving...");
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }
    autosaveTimer = setTimeout(() => {
      autosaveDoc();
    }, AUTOSAVE_DEBOUNCE_MS);
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
      const res = await fetch(`/api/docs/${currentDocId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }

      const data = await res.json();
      setSaveStatus("Saved");
      isDirty = false;
      updateDocInList(data);
    } catch (err) {
      console.error(err);
      setSaveStatus("Save failed");
    }
  }

  async function loadDocsList() {
    const res = await fetch("/api/docs");

    if (!res.ok) {
      docsList.innerHTML = "<p>Unable to load documents.</p>";
      return;
    }

    allDocs = await res.json();
    renderDocs(allDocs);
  }

  function renderDocs(docs) {
    docsList.innerHTML = "";
    const query = docSearchInput.value.toLowerCase();

    const filtered = docs.filter((doc) => doc.title.toLowerCase().includes(query));

    if (!filtered.length) {
      docsList.innerHTML = "<p>No documents found.</p>";
      return;
    }

    filtered.forEach((doc) => {
      const item = document.createElement("div");
      item.className = "doc-item";
      if (doc.id === currentDocId) {
        item.classList.add("active");
      }
      const title = document.createElement("strong");
      title.textContent = doc.title;

      const meta = document.createElement("span");
      meta.className = "doc-meta";
      meta.textContent = `Updated ${new Date(doc.updated_at).toLocaleString()}`;

      item.append(title, meta);
      item.addEventListener("click", () => openDoc(doc.id));
      docsList.appendChild(item);
    });
  }

  docSearchInput.addEventListener("input", () => renderDocs(allDocs));

  function updateDocInList(doc) {
    if (!doc || !doc.id) return;
    const existingIndex = allDocs.findIndex((entry) => entry.id === doc.id);
    if (existingIndex >= 0) {
      allDocs[existingIndex] = { ...allDocs[existingIndex], ...doc };
    } else {
      allDocs.unshift(doc);
    }
    renderDocs(allDocs);
  }

  document.getElementById("new-doc-btn").addEventListener("click", async () => {
    try {
      await autosaveDoc();
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error("Failed to create doc");
      }

      const doc = await res.json();
      await loadDocsList();
      openDoc(doc.id);
    } catch (err) {
      console.error(err);
    }
  });

  async function openDoc(docId) {
    await autosaveDoc();
    const res = await fetch(`/api/docs/${docId}`);

    if (!res.ok) {
      console.error("Failed to load document");
      return false;
    }

    const doc = await res.json();
    currentDocId = doc.id;
    currentCitationIds = doc.citation_ids || [];
    docTitleInput.value = doc.title;

    if (doc.content_delta && Array.isArray(doc.content_delta.ops) && doc.content_delta.ops.length) {
      quill.setContents(normalizeDelta(doc.content_delta), "silent");
    } else if (doc.content_html) {
      quill.setText("", "silent");
      quill.clipboard.dangerouslyPasteHTML(doc.content_html, "silent");
    } else {
      quill.setContents(normalizeDelta(doc.content_delta), "silent");
    }

    setSaveStatus("Idle");
    isDirty = false;
    changedSinceCheckpoint = 0;
    lastCheckpointAt = Date.now();

    await refreshInDocCitations();
    if (ENABLE_OUTLINE) {
      buildAndRenderOutline();
    }
    if (ENABLE_CHECKPOINTS) {
      await loadCheckpoints();
    }
    renderDocs(allDocs);
    return true;
  }

  function applyMarkdownShortcuts() {
    if (markdownState.inProgress) return;
    const range = quill.getSelection(true);
    if (!range) return;

    const [line, lineOffset] = quill.getLine(range.index);
    if (!line) return;
    const lineStart = range.index - lineOffset;
    const lineText = quill.getText(lineStart, line.length()).replace(/\n$/, "");

    const rules = [
      { regex: /^###\s$/, apply: () => quill.formatLine(lineStart, 1, "header", 3, "user") },
      { regex: /^##\s$/, apply: () => quill.formatLine(lineStart, 1, "header", 2, "user") },
      { regex: /^#\s$/, apply: () => quill.formatLine(lineStart, 1, "header", 1, "user") },
      { regex: /^-\s$/, apply: () => quill.formatLine(lineStart, 1, "list", "bullet", "user") },
      { regex: /^1\.\s$/, apply: () => quill.formatLine(lineStart, 1, "list", "ordered", "user") },
    ];

    const matched = rules.find((rule) => rule.regex.test(lineText));
    if (matched) {
      markdownState.inProgress = true;
      quill.deleteText(lineStart, lineText.length, "user");
      matched.apply();
      quill.setSelection(lineStart, 0, "silent");
      markdownState.inProgress = false;
      return;
    }

    if (range.length > 0) return;
    applyInlineMarkdown(range.index);
  }

  function applyInlineMarkdown(cursorIndex) {
    const start = Math.max(0, cursorIndex - 120);
    const chunk = quill.getText(start, cursorIndex - start);
    const patterns = [
      { regex: /\*\*([^*\n]+)\*\*$/, format: { bold: true } },
      { regex: /\*([^*\n]+)\*$/, format: { italic: true } },
      { regex: /~~([^~\n]+)~~$/, format: { strike: true } },
      { regex: /`([^`\n]+)`$/, format: { code: true } },
    ];

    for (const pattern of patterns) {
      const match = chunk.match(pattern.regex);
      if (!match) continue;
      const full = match[0];
      const inner = match[1];
      const fullStart = cursorIndex - full.length;

      markdownState.inProgress = true;
      quill.deleteText(fullStart, full.length, "user");
      quill.insertText(fullStart, inner, pattern.format, "user");
      quill.setSelection(fullStart + inner.length, 0, "silent");
      markdownState.inProgress = false;
      break;
    }
  }

  function buildOutlineFromDelta(delta) {
    const ops = (delta && Array.isArray(delta.ops) && delta.ops) || [];
    const outline = [];
    let textBuffer = "";
    let lineStartIndex = 0;
    let index = 0;

    const pushLine = (attributes = {}) => {
      const level = attributes && attributes.header;
      if (level && level >= 1 && level <= 3) {
        outline.push({
          level,
          text: textBuffer.trim() || `Heading ${outline.length + 1}`,
          index: lineStartIndex,
        });
      }
      textBuffer = "";
      lineStartIndex = index;
    };

    ops.forEach((op) => {
      if (typeof op.insert !== "string") {
        index += 1;
        return;
      }

      for (let i = 0; i < op.insert.length; i += 1) {
        const ch = op.insert[i];
        if (ch === "\n") {
          pushLine(op.attributes || {});
          index += 1;
        } else {
          textBuffer += ch;
          index += 1;
        }
      }
    });

    return outline;
  }

  function renderOutline(outlineItems) {
    outlineList.innerHTML = "";
    if (!outlineItems.length) {
      outlineList.innerHTML = '<p class="empty-state">No headings yet. Add H1/H2/H3 to build the outline.</p>';
      return;
    }

    outlineItems.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = `outline-item level-${item.level}`;
      btn.textContent = item.text;
      btn.addEventListener("click", () => {
        quill.setSelection(item.index, 0, "user");
        quill.focus();
      });
      outlineList.appendChild(btn);
    });
  }

  function buildAndRenderOutline() {
    const outline = buildOutlineFromDelta(quill.getContents());
    renderOutline(outline);
  }

  function scheduleOutlineBuild() {
    if (!ENABLE_OUTLINE) return;
    if (outlineTimer) {
      clearTimeout(outlineTimer);
    }
    outlineTimer = setTimeout(() => {
      buildAndRenderOutline();
    }, OUTLINE_DEBOUNCE_MS);
  }

  async function loadCheckpoints() {
    if (!ENABLE_CHECKPOINTS || !currentDocId) return;
    const res = await fetch(`/api/docs/${currentDocId}/checkpoints?limit=15`);
    if (!res.ok) {
      historyList.innerHTML = '<p class="empty-state">History unavailable.</p>';
      return;
    }
    const checkpoints = await res.json();
    renderCheckpoints(checkpoints);
  }

  function renderCheckpoints(checkpoints = []) {
    historyList.innerHTML = "";
    if (!checkpoints.length) {
      historyList.innerHTML = '<p class="empty-state">No checkpoints yet.</p>';
      return;
    }

    checkpoints.forEach((checkpoint) => {
      const row = document.createElement("div");
      row.className = "history-row";

      const label = document.createElement("span");
      label.className = "doc-meta";
      label.textContent = new Date(checkpoint.created_at).toLocaleString();

      const restoreBtn = document.createElement("button");
      restoreBtn.className = "secondary";
      restoreBtn.textContent = "Restore";
      restoreBtn.addEventListener("click", async () => {
        await restoreCheckpoint(checkpoint.id);
      });

      row.append(label, restoreBtn);
      historyList.appendChild(row);
    });
  }

  async function createCheckpointIfNeeded(force = false) {
    if (!currentDocId) return;

    const now = Date.now();
    const byTime = now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS;
    const byChange = changedSinceCheckpoint >= CHECKPOINT_CHANGE_THRESHOLD;

    if (!force && !byTime && !byChange) return;

    const payload = {
      content_delta: quill.getContents(),
      content_html: quill.root.innerHTML,
    };

    try {
      const res = await fetch(`/api/docs/${currentDocId}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        changedSinceCheckpoint = 0;
        lastCheckpointAt = now;
        await loadCheckpoints();
      }
    } catch (error) {
      console.warn("checkpoint failed", error);
    }
  }

  async function restoreCheckpoint(checkpointId) {
    if (!currentDocId || !checkpointId) return;
    const confirmed = window.confirm("Restore this checkpoint? Current editor content will be replaced.");
    if (!confirmed) return;

    await createCheckpointIfNeeded(true);

    const res = await fetch(`/api/docs/${currentDocId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint_id: checkpointId }),
    });

    if (!res.ok) {
      alert("Failed to restore checkpoint.");
      return;
    }

    const doc = await res.json();
    quill.setContents(normalizeDelta(doc.content_delta), "silent");
    isDirty = false;
    setSaveStatus("Restored");
    buildAndRenderOutline();
    await loadCheckpoints();
  }

  outlineRefreshBtn.addEventListener("click", () => buildAndRenderOutline());
  outlineToggleBtn.addEventListener("click", () => {
    outlinePanel.classList.toggle("collapsed");
    outlineToggleBtn.textContent = outlinePanel.classList.contains("collapsed")
      ? "Expand"
      : "Collapse";
  });
  historyRefreshBtn.addEventListener("click", () => loadCheckpoints());

  async function fetchCitations({ search = "", limit = 50 } = {}) {
    const params = new URLSearchParams();
    params.set("limit", limit);
    if (search) {
      params.set("search", search);
    }

    const res = await fetch(`/api/citations?${params.toString()}`);

    if (!res.ok) {
      throw new Error("Failed to load citations");
    }

    const citations = await res.json();
    citations.forEach((citation) => {
      citationCache.set(citation.id, citation);
    });
    return citations;
  }

  async function fetchCitationsByIds(ids = []) {
    if (!ids.length) return [];
    const params = new URLSearchParams();
    params.set("ids", ids.join(","));

    const res = await fetch(`/api/citations/by_ids?${params.toString()}`);

    if (!res.ok) {
      throw new Error("Failed to load citations");
    }

    const citations = await res.json();
    citations.forEach((citation) => {
      citationCache.set(citation.id, citation);
    });
    return citations;
  }

  function formatCitationPreview(citation) {
    let domain = "source";
    if (citation.url) {
      try {
        domain = new URL(citation.url).hostname;
      } catch (error) {
        domain = citation.url;
      }
    }
    const excerpt = citation.excerpt || "No excerpt available";
    const citedAt = citation.cited_at ? new Date(citation.cited_at).toLocaleDateString() : "";
    return { domain, excerpt, citedAt };
  }

  function selectCitationCard(card, citationId) {
    document.querySelectorAll(".citation-card").forEach((node) => {
      node.classList.remove("selected");
    });
    selectedCitationId = citationId;
    card.classList.add("selected");
  }

  function buildCitationCard(citation, { showRemove = false, showAttach = true } = {}) {
    const { domain, excerpt, citedAt } = formatCitationPreview(citation);
    const card = document.createElement("div");
    card.className = "citation-card";
    card.dataset.citationId = citation.id;
    const title = document.createElement("strong");
    title.textContent = domain;

    const body = document.createElement("p");
    body.textContent = excerpt;

    const meta = document.createElement("span");
    meta.className = "doc-meta";
    const formatLabel = citation.format ? citation.format.toUpperCase() : "";
    const metaParts = [];
    if (formatLabel) {
      metaParts.push(formatLabel);
    }
    if (citedAt) {
      metaParts.push(citedAt);
    }
    meta.textContent = metaParts.join(" · ");

    card.append(title, body, meta);

    card.addEventListener("click", () => {
      selectCitationCard(card, citation.id);
      if (showRemove) {
        jumpToCitation(citation.id);
      }
    });

    const actions = document.createElement("div");
    actions.className = "citation-actions";

    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert in-text";
    insertBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      insertCitationToken(citation);
    });

    const attachBtn = document.createElement("button");
    attachBtn.textContent = "Attach to doc";
    attachBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      attachCitation(citation.id);
    });

    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy full";
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await navigator.clipboard.writeText(citation.full_text || "");
    });

    actions.append(insertBtn);
    if (showAttach) {
      actions.append(attachBtn);
    }
    actions.append(copyBtn);

    if (showRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        removeCitationFromDoc(citation.id);
      });
      actions.append(removeBtn);
    }

    card.appendChild(actions);
    return card;
  }

  async function loadCitationLibrary(search = "") {
    const citations = await fetchCitations({ search, limit: 50 });
    const container = document.getElementById("citations-list");
    container.innerHTML = "";

    citations.forEach((citation) => {
      const card = buildCitationCard(citation);
      container.appendChild(card);
    });
  }

  async function refreshInDocCitations() {
    if (!currentDocId) return;

    const missingIds = currentCitationIds.filter((id) => !citationCache.has(id));
    if (missingIds.length) {
      await fetchCitationsByIds(missingIds);
    }
    const citations = Array.from(citationCache.values());
    const container = document.getElementById("doc-citations-list");
    container.innerHTML = "";

    const docCitations = citations.filter((citation) => currentCitationIds.includes(citation.id));

    if (!docCitations.length) {
      container.innerHTML = "<p>No citations attached yet.</p>";
      return;
    }

    docCitations.forEach((citation) => {
      const card = buildCitationCard(citation, { showRemove: true, showAttach: false });
      container.appendChild(card);
    });
  }

  function attachCitation(citationId) {
    if (!currentDocId) {
      alert("Open a document before attaching citations.");
      return;
    }
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

  function insertCitationToken(citation) {
    let citationData = citation;
    if (!citationData && selectedCitationId) {
      citationData = citationCache.get(selectedCitationId);
    }

    if (!citationData) {
      alert("Select a citation to insert.");
      return;
    }

    const token = `${citeTokenPrefix}${citationData.id}${citeTokenSuffix}`;
    const metadata = citationData.metadata || {};
    const author = metadata.author || metadata.creator;
    const year = metadata.year || metadata.published_year;
    const fallback = citationData.url ? formatCitationPreview(citationData).domain : "source";
    const inText = author && year ? `(${author}, ${year})` : `(${fallback})`;

    const range = quill.getSelection(true);
    const insertIndex = range ? range.index : quill.getLength();
    quill.insertText(insertIndex, `${inText} ${token} `, {
      background: "#eef4ff",
    }, "user");
    quill.setSelection(insertIndex + inText.length + token.length + 2);

    attachCitation(citationData.id);
  }

  function insertCitationQuote() {
    let citationData = null;
    if (selectedCitationId) {
      citationData = citationCache.get(selectedCitationId);
    }

    if (!citationData) {
      alert("Select a citation to insert a quote.");
      return;
    }

    const quoteText = citationData.excerpt || citationData.full_text || "";
    const token = `${citeTokenPrefix}${citationData.id}${citeTokenSuffix}`;
    const range = quill.getSelection(true);
    const insertIndex = range ? range.index : quill.getLength();

    quill.insertText(insertIndex, `\n${quoteText}\n${token}\n`, { blockquote: true });
    quill.setSelection(insertIndex + quoteText.length + token.length + 3);

    attachCitation(citationData.id);
  }

  function removeCitationTokens(citationId) {
    const token = `${citeTokenPrefix}${citationId}${citeTokenSuffix}`;
    const text = quill.getText();
    const indices = [];
    let index = text.indexOf(token);
    while (index !== -1) {
      indices.push(index);
      index = text.indexOf(token, index + token.length);
    }
    for (let i = indices.length - 1; i >= 0; i -= 1) {
      quill.deleteText(indices[i], token.length);
    }
  }

  function jumpToCitation(citationId) {
    const token = `${citeTokenPrefix}${citationId}${citeTokenSuffix}`;
    const index = quill.getText().indexOf(token);
    if (index !== -1) {
      quill.setSelection(index, token.length);
      quill.focus();
      setSaveStatus("Jumped to citation");
    } else {
      setSaveStatus("Citation token not found");
    }
  }

  document.getElementById("citation-search").addEventListener("input", (event) => {
    if (citationSearchTimer) {
      clearTimeout(citationSearchTimer);
    }
    const query = event.target.value;
    citationSearchTimer = setTimeout(async () => {
      await loadCitationLibrary(query);
    }, 250);
  });

  const tabs = document.querySelectorAll(".tab");
  const panels = {
    library: document.getElementById("tab-library"),
    "in-doc": document.getElementById("tab-in-doc"),
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((btn) => btn.classList.remove("active"));
      tab.classList.add("active");
      Object.values(panels).forEach((panel) => panel.classList.remove("active"));
      panels[tab.dataset.tab].classList.add("active");
    });
  });

  exportBtn.addEventListener("click", async () => {
    if (!currentDocId) return;
    exportModal.setAttribute("aria-hidden", "false");

    const res = await fetch(`/api/docs/${currentDocId}/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        style: exportStyle.value,
        html: quill.root.innerHTML,
        text: quill.getText(),
      }),
    });

    if (!res.ok) {
      exportHtml.textContent = "Export failed";
      exportText.textContent = "";
      exportBibliography.innerHTML = "";
      return;
    }

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

  exportStyle.addEventListener("change", () => {
    if (exportModal.getAttribute("aria-hidden") === "false") {
      exportBtn.click();
    }
  });

  document.getElementById("close-export").addEventListener("click", () => {
    exportModal.setAttribute("aria-hidden", "true");
  });

  window.addEventListener("click", (event) => {
    if (event.target === exportModal) {
      exportModal.setAttribute("aria-hidden", "true");
    }
  });

  (async () => {
    await loadDocsList();
    await loadCitationLibrary();
    const urlParams = new URLSearchParams(window.location.search);
    const initialDocId = urlParams.get("doc");
    let opened = false;
    if (initialDocId) {
      opened = await openDoc(initialDocId);
    }
    if (!opened) {
      if (allDocs.length) {
        await openDoc(allDocs[0].id);
      } else {
        document.getElementById("new-doc-btn").click();
      }
    }
  })();
}

(async () => {
  if (await verifyPaidAccess()) {
    startEditor();
  }
})();
