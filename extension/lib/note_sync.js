export function normalizeTimestamp(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

export function deriveSourceHostname(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function normalizeExplicitSources(sources) {
  const normalized = [];
  const seen = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== "object") {
      continue;
    }
    const url = String(source.url || "").trim();
    if (!url) {
      continue;
    }
    const dedupeKey = url.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push({
      ...source,
      url,
    });
  }
  return normalized;
}

export function buildCanonicalSources(note, { now = new Date().toISOString() } = {}) {
  const explicitSources = normalizeExplicitSources(note?.sources);
  if (explicitSources.length > 0) {
    return explicitSources;
  }
  if (!note?.source_url) {
    return [];
  }
  return [{
    url: note.source_url,
    title: note.source_title || null,
    hostname: deriveSourceHostname(note.source_url),
    source_author: note.source_author || null,
    source_published_at: note.source_published_at || null,
    attached_at: normalizeTimestamp(note.timestamp) || normalizeTimestamp(note.created_at) || now,
  }];
}

export function normalizeQueuedNote(note = {}) {
  const normalized = { ...note };
  if (Array.isArray(note.sources)) {
    normalized.sources = normalizeExplicitSources(note.sources);
  }
  if (Array.isArray(note.linked_note_ids)) {
    normalized.linked_note_ids = [...note.linked_note_ids];
  }
  return normalized;
}

export function normalizeQueuedOperation(operation = {}, { queuedAt = new Date().toISOString() } = {}) {
  const normalized = {
    ...operation,
    queued_at: operation.queued_at || queuedAt,
  };
  if (operation.note && typeof operation.note === "object") {
    normalized.note = normalizeQueuedNote(operation.note);
  }
  return normalized;
}

export function buildCanonicalNotePayloadBase(note, { project_id = null, tag_ids = [], now = new Date().toISOString() } = {}) {
  return {
    id: note.id,
    title: note.title || null,
    highlight_text: note.highlight_text || null,
    note_body: note.note_body || "",
    source_url: note.source_url || null,
    source_title: note.source_title || null,
    source_author: note.source_author || null,
    source_published_at: note.source_published_at || null,
    project_id,
    citation_id: note.citation_id || null,
    quote_id: note.quote_id || null,
    tag_ids,
    sources: buildCanonicalSources(note, { now }),
    linked_note_ids: Array.isArray(note.linked_note_ids) ? note.linked_note_ids : [],
    created_at: note.created_at,
    updated_at: note.updated_at || now,
  };
}
