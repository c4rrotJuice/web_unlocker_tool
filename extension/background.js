import { apiFetch } from "./lib/api.js";
import { createSupabaseAuthClient } from "./lib/supabase.js";
import { BACKEND_BASE_URL } from "./config.js";

const USAGE_KEY = "usage_snapshot";
const NOTES_KEY = "notes_state";
const NOTES_SYNC_QUEUE_KEY = "notes_sync_queue";
const BACKGROUND_SYNC_QUEUE_KEY = "background_sync_queue";
const REFRESH_WINDOW_SECONDS = 120;
const SIDEPANEL_COLLAPSED_KEY = "sidepanel_collapsed";
const RESEARCH_LAST_SELECTION_KEY = "research_last_selection";
const RESEARCH_DB_NAME = "writior_research_state";
const RESEARCH_DB_VERSION = 1;
const TIER_CACHE_KEY = "tier_cache";
let sidePanelRuntimeOpen = false;

const researchState = {
  notes: [],
  citations: [],
  lastSelection: "",
};
const supabaseClient = createSupabaseAuthClient();
let debugEnabled = false;
const debug = (...args) => {
  if (debugEnabled) {
    console.debug("[Web Unlocker]", ...args);
  }
};

chrome.storage.local
  .get({ webUnlockerDebug: false })
  .then(({ webUnlockerDebug }) => {
    debugEnabled = Boolean(webUnlockerDebug);
  })
  .catch(() => {
    debugEnabled = false;
  });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.webUnlockerDebug) {
    return;
  }
  debugEnabled = Boolean(changes.webUnlockerDebug.newValue);
});

void migrateLegacyNotesStateIfNeeded();
void hydrateResearchState();

function openResearchDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(RESEARCH_DB_NAME, RESEARCH_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("notes")) {
        db.createObjectStore("notes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("citations")) {
        db.createObjectStore("citations", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb_open_failed"));
  });
}

async function withResearchStore(storeName, mode, callback) {
  const db = await openResearchDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let callbackResult;
    try {
      callbackResult = callback(store);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(callbackResult);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("indexeddb_tx_failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error("indexeddb_tx_aborted"));
    };
  });
}

async function readAllFromStore(storeName) {
  const db = await openResearchDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error("indexeddb_read_failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

async function hydrateResearchState() {
  try {
    const [notes, citations, selectionPayload] = await Promise.all([
      readAllFromStore("notes"),
      readAllFromStore("citations"),
      readStorage({ [RESEARCH_LAST_SELECTION_KEY]: "" }),
    ]);
    researchState.notes = notes;
    researchState.citations = citations;
    researchState.lastSelection = String(selectionPayload?.[RESEARCH_LAST_SELECTION_KEY] || "");
  } catch (error) {
    debug("hydrateResearchState failed", error);
  }
}

async function setResearchLastSelection(text) {
  const lastSelection = String(text || "");
  researchState.lastSelection = lastSelection;
  await writeStorage({ [RESEARCH_LAST_SELECTION_KEY]: lastSelection });
}

async function upsertResearchNote(note) {
  if (!note?.id) return;
  const next = { ...note };
  await withResearchStore("notes", "readwrite", (store) => {
    store.put(next);
  });
  const index = researchState.notes.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    researchState.notes[index] = next;
  } else {
    researchState.notes.unshift(next);
  }
}

async function deleteResearchNote(noteId) {
  if (!noteId) return;
  await withResearchStore("notes", "readwrite", (store) => {
    store.delete(noteId);
  });
  researchState.notes = researchState.notes.filter((item) => item.id !== noteId);
}

function normalizeCitationRecord(payload = {}, responseData = {}) {
  const id = responseData.id || payload.id || `citation_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    id,
    url: payload.url || responseData.url || null,
    excerpt: payload.excerpt || responseData.excerpt || null,
    format: payload.format || responseData.format || null,
    inline_citation: payload.inline_citation || responseData.inline_citation || null,
    full_citation: payload.full_citation || responseData.full_citation || payload.full_text || null,
    cited_at: responseData.cited_at || new Date().toISOString(),
  };
}

async function upsertResearchCitation(record) {
  if (!record?.id) return;
  await withResearchStore("citations", "readwrite", (store) => {
    store.put(record);
  });
  const index = researchState.citations.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    researchState.citations[index] = record;
  } else {
    researchState.citations.unshift(record);
  }
}

function getTierPolicy(tier = "free", isAuthenticated = false) {
  const normalizedTier = String(tier || "free").toLowerCase();
  if (normalizedTier === "pro") {
    return { tier: "pro", citations: -1, documents: -1, periodMs: 24 * 60 * 60 * 1000, sync_enabled: true };
  }
  if (normalizedTier === "standard") {
    return { tier: "standard", citations: 15, documents: 14, periodMs: 14 * 24 * 60 * 60 * 1000, sync_enabled: true };
  }
  if (isAuthenticated) {
    return { tier: "free", citations: 10, documents: 3, periodMs: 24 * 60 * 60 * 1000, sync_enabled: true };
  }
  return { tier: "free", citations: 5, documents: 0, periodMs: 7 * 24 * 60 * 60 * 1000, sync_enabled: false };
}

function parseResetTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

async function getTierCache() {
  const { [TIER_CACHE_KEY]: tierCache } = await readStorage({ [TIER_CACHE_KEY]: null });
  if (tierCache && typeof tierCache === "object") {
    return tierCache;
  }
  const base = getTierPolicy("free", false);
  const created = {
    tier: base.tier,
    is_authenticated: false,
    citations_remaining: base.citations,
    documents_remaining: base.documents,
    reset_timestamp: Date.now() + base.periodMs,
    sync_enabled: base.sync_enabled,
  };
  await writeStorage({ [TIER_CACHE_KEY]: created });
  return created;
}

async function setTierCache(cache) {
  await writeStorage({ [TIER_CACHE_KEY]: cache });
}

function normalizeTierFromUsage(usage, session) {
  const accountType = String(usage?.account_type || (session ? "free" : "anonymous")).toLowerCase();
  if (accountType === "pro") return { tier: "pro", isAuthenticated: true };
  if (accountType === "standard") return { tier: "standard", isAuthenticated: true };
  if (accountType === "free" || accountType === "freemium") return { tier: "free", isAuthenticated: Boolean(session) };
  return { tier: "free", isAuthenticated: false };
}

async function hydrateTierCacheFromUsage(usage, session) {
  const current = await getTierCache();
  const normalized = normalizeTierFromUsage(usage, session);
  const policy = getTierPolicy(normalized.tier, normalized.isAuthenticated);
  const usageResetTs = parseResetTimestamp(usage?.reset_at);
  const now = Date.now();
  const hasSameTier = current.tier === policy.tier && Boolean(current.is_authenticated) === normalized.isAuthenticated;
  const notExpired = Number(current.reset_timestamp) > now;

  const next = hasSameTier && notExpired
    ? {
        ...current,
        tier: policy.tier,
        is_authenticated: normalized.isAuthenticated,
        sync_enabled: policy.sync_enabled,
      }
    : {
        tier: policy.tier,
        is_authenticated: normalized.isAuthenticated,
        citations_remaining: policy.citations,
        documents_remaining: policy.documents,
        reset_timestamp: usageResetTs || now + policy.periodMs,
        sync_enabled: policy.sync_enabled,
      };

  await setTierCache(next);
  return next;
}

async function getTierCacheWithAutoReset() {
  const cache = await getTierCache();
  const now = Date.now();
  if (!cache?.reset_timestamp || Number(cache.reset_timestamp) > now) {
    return cache;
  }
  const policy = getTierPolicy(cache.tier, Boolean(cache.is_authenticated));
  const reset = {
    ...cache,
    citations_remaining: policy.citations,
    documents_remaining: policy.documents,
    reset_timestamp: now + policy.periodMs,
    sync_enabled: policy.sync_enabled,
  };
  await setTierCache(reset);
  return reset;
}

async function consumeTierCredit(kind) {
  const cache = await getTierCacheWithAutoReset();
  const field = kind === "documents" ? "documents_remaining" : "citations_remaining";
  const current = Number(cache[field]);
  if (!Number.isFinite(current) || current < 0) {
    return { allowed: true, cache };
  }
  if (current <= 0) {
    return { allowed: false, cache };
  }
  const next = { ...cache, [field]: current - 1 };
  await setTierCache(next);
  return { allowed: true, cache: next };
}


async function isSidePanelCollapsed() {
  const payload = await readStorage({ [SIDEPANEL_COLLAPSED_KEY]: false });
  return Boolean(payload?.[SIDEPANEL_COLLAPSED_KEY]);
}

async function setSidePanelCollapsed(collapsed) {
  await writeStorage({ [SIDEPANEL_COLLAPSED_KEY]: Boolean(collapsed) });
}

async function applySidePanelState() {
  if (!chrome.sidePanel?.setOptions) return;
  const collapsed = await isSidePanelCollapsed();
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: !collapsed });
  sidePanelRuntimeOpen = false;
}

async function resolveActiveTab(tabId) {
  if (Number.isInteger(tabId)) {
    return chrome.tabs.get(tabId).catch(() => null);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function openSidePanel(tabId, windowId) {
  if (!chrome.sidePanel?.open || !chrome.sidePanel?.setOptions) {
    return { error: "sidepanel_unavailable" };
  }
  let targetWindowId = Number.isInteger(windowId) ? windowId : null;
  if (!Number.isInteger(targetWindowId)) {
    const activeTab = await resolveActiveTab(tabId);
    targetWindowId = Number.isInteger(activeTab?.windowId) ? activeTab.windowId : null;
  }
  if (!Number.isInteger(targetWindowId)) {
    return { error: "sidepanel_window_unavailable" };
  }

  // Keep setOptions/open invocation in the same event tick to preserve
  // user-gesture eligibility when triggered from a page click.
  const enablePromise = chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
  const openPromise = chrome.sidePanel.open({ windowId: targetWindowId });
  await Promise.all([enablePromise, openPromise]);

  await setSidePanelCollapsed(false);
  sidePanelRuntimeOpen = true;
  return { ok: true, collapsed: false };
}

async function collapseSidePanel() {
  if (!chrome.sidePanel?.setOptions) {
    return { error: "sidepanel_unavailable" };
  }
  await setSidePanelCollapsed(true);
  await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: false });
  sidePanelRuntimeOpen = false;
  return { ok: true, collapsed: true };
}

async function toggleSidePanel(tabId, windowId) {
  if (sidePanelRuntimeOpen) {
    return collapseSidePanel();
  }
  return openSidePanel(tabId, windowId);
}

void applySidePanelState();

chrome.runtime.onInstalled?.addListener(() => {
  void applySidePanelState();
  void flushBackgroundSyncQueue();
  void flushSyncQueue();
});

chrome.runtime.onStartup?.addListener(() => {
  void applySidePanelState();
  void flushBackgroundSyncQueue();
  void flushSyncQueue();
});

chrome.action.onClicked?.addListener((tab) => {
  void toggleSidePanel(tab?.id, tab?.windowId);
});

chrome.sidePanel?.onPanelOpened?.addListener(() => {
  sidePanelRuntimeOpen = true;
});

chrome.sidePanel?.onPanelClosed?.addListener(() => {
  sidePanelRuntimeOpen = false;
});

function getNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function readStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function writeStorage(payload) {
  await chrome.storage.local.set(payload);
}

async function clearStorage(keys) {
  await chrome.storage.local.remove(keys);
}

function createId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function normalizeTier(accountType) {
  return String(accountType || "anonymous").toLowerCase();
}

function getSyncStorageLimitBytes(accountType, isAuthenticated) {
  if (!isAuthenticated) return Number.POSITIVE_INFINITY;
  const tier = normalizeTier(accountType);
  if (tier === "pro") return 30 * 1024 * 1024;
  if (tier === "standard") return 10 * 1024 * 1024;
  return 5 * 1024 * 1024;
}

function estimateSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function parseTagsInput(input) {
  if (Array.isArray(input)) return input.map((v) => String(v).trim()).filter(Boolean);
  return String(input || "").split(",").map((v) => v.trim()).filter(Boolean);
}

async function getNotesState() {
  const { [NOTES_KEY]: notesState } = await readStorage([NOTES_KEY]);
  return notesState || { notes: [], tags: [], projects: [] };
}

function normalizeNotesStateIds(state) {
  const nextTags = [];
  const nextProjects = [];
  const tagIdMap = new Map();
  const projectIdMap = new Map();

  for (const tag of state.tags || []) {
    const normalizedId = isUuid(tag.id) ? tag.id : createUuid();
    tagIdMap.set(tag.id, normalizedId);
    nextTags.push({ ...tag, id: normalizedId });
  }

  for (const project of state.projects || []) {
    const normalizedId = isUuid(project.id) ? project.id : createUuid();
    projectIdMap.set(project.id, normalizedId);
    nextProjects.push({ ...project, id: normalizedId });
  }

  const nextNotes = (state.notes || []).map((note) => ({
    ...note,
    id: isUuid(note.id) ? note.id : createUuid(),
    project_id: note.project_id ? (projectIdMap.get(note.project_id) || (isUuid(note.project_id) ? note.project_id : null)) : null,
    tags: Array.isArray(note.tags)
      ? note.tags
          .map((tagId) => tagIdMap.get(tagId) || (isUuid(tagId) ? tagId : null))
          .filter(Boolean)
      : [],
  }));

  return { notes: nextNotes, tags: nextTags, projects: nextProjects };
}

async function migrateLegacyNotesStateIfNeeded() {
  const state = await getNotesState();
  const normalized = normalizeNotesStateIds(state);
  if (JSON.stringify(normalized) !== JSON.stringify(state)) {
    await setNotesState(normalized);
  }
}

async function setNotesState(state) {
  await writeStorage({ [NOTES_KEY]: state });
}

async function getSyncQueue() {
  const { [NOTES_SYNC_QUEUE_KEY]: queue } = await readStorage([NOTES_SYNC_QUEUE_KEY]);
  return Array.isArray(queue) ? queue : [];
}

async function setSyncQueue(queue) {
  await writeStorage({ [NOTES_SYNC_QUEUE_KEY]: queue });
}

async function getBackgroundSyncQueue() {
  const { [BACKGROUND_SYNC_QUEUE_KEY]: queue } = await readStorage([BACKGROUND_SYNC_QUEUE_KEY]);
  return Array.isArray(queue) ? queue : [];
}

async function setBackgroundSyncQueue(queue) {
  await writeStorage({ [BACKGROUND_SYNC_QUEUE_KEY]: queue });
}

async function enqueueBackgroundSyncOperation(operation) {
  const queue = await getBackgroundSyncQueue();
  queue.push({ ...operation, queued_at: new Date().toISOString() });
  await setBackgroundSyncQueue(queue);
}

let backgroundSyncInFlight = false;
async function flushBackgroundSyncQueue() {
  if (backgroundSyncInFlight) return;
  backgroundSyncInFlight = true;
  try {
    const session = await ensureValidSession();
    if (!session) return;
    const queue = await getBackgroundSyncQueue();
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
      try {
        if (item.type === "citation") {
          const response = await apiFetch(
            "/api/citations",
            { method: "POST", body: JSON.stringify(item.payload || {}) },
            session.access_token,
          );
          if (!response.ok) {
            if (response.status === 401) {
              await clearSession();
              remaining.push(item);
              break;
            }
            remaining.push(item);
          }
          continue;
        }

        if (item.type === "usage_event") {
          const response = await apiFetch(
            "/api/extension/usage-event",
            { method: "POST", body: JSON.stringify(item.payload || {}) },
            session.access_token,
          );
          if (!response.ok) {
            if (response.status === 401) {
              await clearSession();
              remaining.push(item);
              break;
            }
            remaining.push(item);
          }
          continue;
        }
      } catch (error) {
        remaining.push(item);
      }
    }

    await setBackgroundSyncQueue(remaining);
  } finally {
    backgroundSyncInFlight = false;
  }
}

function upsertNamedEntity(list, name) {
  const cleaned = String(name || "").trim();
  if (!cleaned) return { list, entity: null };
  const existing = list.find((item) => item.name.toLowerCase() === cleaned.toLowerCase());
  if (existing) return { list, entity: existing };
  const entity = { id: createUuid(), name: cleaned, created_at: new Date().toISOString() };
  return { list: [...list, entity], entity };
}

async function upsertNote(notePayload = {}) {
  const state = await getNotesState();
  const now = new Date().toISOString();
  let nextProjects = state.projects || [];
  const projectResult = upsertNamedEntity(nextProjects, notePayload.project);
  nextProjects = projectResult.list;

  let nextTags = state.tags || [];
  const resolvedTagIds = [];
  for (const tagValue of parseTagsInput(notePayload.tags)) {
    const existingTag = nextTags.find((item) => item.id === tagValue);
    if (existingTag) {
      resolvedTagIds.push(existingTag.id);
      continue;
    }

    const result = upsertNamedEntity(nextTags, tagValue);
    nextTags = result.list;
    if (result.entity) {
      resolvedTagIds.push(result.entity.id);
    }
  }

  const note = {
    id: isUuid(notePayload.id) ? notePayload.id : createUuid(),
    title: (notePayload.title || "").trim(),
    highlight_text: notePayload.highlight_text || null,
    note_body: notePayload.note_body || "",
    source_url: notePayload.source_url || null,
    sources: Array.isArray(notePayload.sources) ? notePayload.sources : [],
    linked_note_ids: Array.isArray(notePayload.linked_note_ids) ? notePayload.linked_note_ids : [],
    project_id: projectResult.entity?.id || notePayload.project_id || null,
    tags: resolvedTagIds,
    created_at: notePayload.created_at || now,
    updated_at: now,
    sync_status: "pending",
  };

  const existingIdx = (state.notes || []).findIndex((item) => item.id === note.id);
  const nextNotes = [...(state.notes || [])];
  if (existingIdx >= 0) {
    nextNotes[existingIdx] = {
      ...nextNotes[existingIdx],
      ...note,
      sources: Array.isArray(notePayload.sources) ? note.sources : (nextNotes[existingIdx].sources || []),
      linked_note_ids: Array.isArray(notePayload.linked_note_ids) ? note.linked_note_ids : (nextNotes[existingIdx].linked_note_ids || []),
      created_at: nextNotes[existingIdx].created_at || note.created_at,
    };
  } else {
    nextNotes.unshift(note);
  }

  const nextState = { notes: nextNotes, tags: nextTags, projects: nextProjects };
  await setNotesState(nextState);
  return { note: existingIdx >= 0 ? nextNotes[existingIdx] : note, state: nextState };
}

function applyFilters(notes, state, filters = {}, sort = "desc") {
  const tagFilter = String(filters.tag || "").trim().toLowerCase();
  const projectFilter = String(filters.project || "").trim().toLowerCase();
  const sourceFilter = String(filters.source || "").trim().toLowerCase();
  const tagIds = (state.tags || []).filter((t) => t.name.toLowerCase().includes(tagFilter)).map((t) => t.id);
  const projectIds = (state.projects || []).filter((p) => p.name.toLowerCase().includes(projectFilter)).map((p) => p.id);

  return notes
    .filter((note) => {
      const byTag = !tagFilter || note.tags?.some((id) => tagIds.includes(id));
      const byProject = !projectFilter || projectIds.includes(note.project_id);
      const bySource = !sourceFilter || String(note.source_url || "").toLowerCase().includes(sourceFilter);
      return byTag && byProject && bySource;
    })
    .sort((a, b) => {
      const av = new Date(a.created_at).getTime();
      const bv = new Date(b.created_at).getTime();
      return sort === "asc" ? av - bv : bv - av;
    });
}

async function enqueueSyncOperation(operation) {
  const queue = await getSyncQueue();
  queue.push({ ...operation, queued_at: new Date().toISOString() });
  await setSyncQueue(queue);
}

let syncInFlight = false;
async function flushSyncQueue() {
  if (syncInFlight) return;
  syncInFlight = true;
  try {
    const session = await ensureValidSession();
    if (!session) return;
    let queue = await getSyncQueue();
    if (!queue.length) return;

    const remaining = [];
    for (const item of queue) {
      const endpoint = item.type === "delete" ? `/api/notes/${encodeURIComponent(item.note.id)}` : "/api/notes";
      const method = item.type === "delete" ? "DELETE" : item.type === "update" ? "PATCH" : "POST";
      const response = await apiFetch(endpoint, { method, body: item.type === "delete" ? undefined : JSON.stringify(item.note) }, session.access_token);
      if (!response.ok) {
        if (response.status === 401) {
          await clearSession();
          remaining.push(item);
          break;
        }
        remaining.push(item);
      }
    }
    queue = remaining;
    await setSyncQueue(queue);
  } finally {
    syncInFlight = false;
  }
}


async function setUsageSnapshot(snapshot) {
  await writeStorage({ [USAGE_KEY]: snapshot });
  const session = await ensureValidSession();
  await hydrateTierCacheFromUsage(snapshot || {}, session);
}

async function getUsageSnapshot() {
  const { [USAGE_KEY]: snapshot } = await readStorage([USAGE_KEY]);
  return snapshot || null;
}

async function getUsageSnapshotForSession(session) {
  const usage = await getUsageSnapshot();
  if (!usage) {
    return null;
  }

  if (session) {
    return usage;
  }

  if (usage.account_type === "anonymous") {
    return usage;
  }

  await clearStorage([USAGE_KEY]);
  return null;
}

async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session || null;
}

async function setSession(session) {
  await supabaseClient.auth.setSession(session || null);
}

async function clearSession() {
  await supabaseClient.auth.setSession(null);
}



async function ensureValidSession() {
  const session = await getSession();
  if (!session) {
    return null;
  }
  const expiresAt = session.expires_at || 0;
  if (expiresAt - getNowSeconds() > REFRESH_WINDOW_SECONDS) {
    return session;
  }

  try {
    const refreshed = await supabaseClient.auth.refreshSession(session.refresh_token);
    const nextSession = {
      ...session,
      ...refreshed,
    };
    await setSession(nextSession);
    return nextSession;
  } catch (error) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
    return null;
  }
}

async function fetchUnlockPermitRemote(payload) {
  const session = await ensureValidSession();
  const response = await apiFetch(
    "/api/extension/unlock-permit",
    {
      method: "POST",
      body: JSON.stringify(payload || {}),
    },
    session?.access_token,
  );

  if (response.status === 401) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  if (response.ok && data) {
    await setUsageSnapshot(data);
  }

  return { status: response.status, data };
}

async function fetchUnlockPermit(payload) {
  const requestPayload = payload || {};
  const isDryRun = Boolean(requestPayload.dry_run);

  if (isDryRun) {
    const snapshot = await getUsageSnapshot();
    if (snapshot) {
      void fetchUnlockPermitRemote(requestPayload).catch((error) => {
        debug("fetchUnlockPermit background refresh failed", error);
      });
      return { status: 200, data: snapshot, local_first: true };
    }
  }

  return fetchUnlockPermitRemote(requestPayload);
}


async function logUsageEvent(payload) {
  await enqueueBackgroundSyncOperation({ type: "usage_event", payload: payload || {} });
  void flushBackgroundSyncQueue();
  return { status: 202, data: { enqueued: true } };
}

function startCitationSync(payload) {
  void enqueueBackgroundSyncOperation({ type: "citation", payload: payload || {} })
    .then(() => flushBackgroundSyncQueue())
    .catch((error) => {
      debug("SAVE_CITATION remote sync enqueue failed", error);
    });
}




async function renderCitation(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/citations/render",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    session.access_token,
  );

  if (response.status === 401) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  return { status: response.status, data };
}


async function fetchRecentCitations(limit = 5) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const response = await apiFetch(
    `/api/citations?${params.toString()}`,
    { method: "GET" },
    session.access_token,
  );

  if (response.status === 401) {
    await clearSession();
    await clearStorage([USAGE_KEY]);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    // ignore
  }

  return { status: response.status, data };
}

async function openAuthedPath(redirectPath) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const handoffResponse = await apiFetch(
    "/api/auth/handoff",
    {
      method: "POST",
      body: JSON.stringify({
        redirect_path: redirectPath,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
      }),
    },
    session.access_token,
  );

  let handoffData = null;
  try {
    handoffData = await handoffResponse.json();
  } catch (error) {
    // ignore
  }

  if (!handoffResponse.ok) {
    if (handoffResponse.status === 401) {
      await clearSession();
      await clearStorage([USAGE_KEY]);
    }
    return {
      status: handoffResponse.status,
      error: handoffData?.detail || handoffData?.error || "handoff_failed",
    };
  }

  if (!handoffData?.code) {
    return {
      status: handoffResponse.status,
      error: "handoff_code_missing",
    };
  }

  const handoffUrl = `${BACKEND_BASE_URL}/auth/handoff?code=${encodeURIComponent(
    handoffData.code,
  )}`;
  chrome.tabs.create({ url: handoffUrl });
  return { status: 200, data: { redirect_path: redirectPath } };
}

async function workInEditor(payload) {
  try {
    const session = await ensureValidSession();
    if (!session) {
      return { error: "unauthenticated", status: 401 };
    }

    const response = await apiFetch(
      "/api/extension/selection",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      session.access_token,
    );

    if (response.status === 401) {
      await clearSession();
      await clearStorage([USAGE_KEY]);
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      // ignore
    }

    if (!response.ok) {
      return {
        status: response.status,
        error: data?.detail || data?.error || "request_failed",
      };
    }

    if (!data?.editor_url) {
      return {
        status: response.status,
        error: "missing_editor_url",
      };
    }

    const normalizeRedirectPath = (editorUrl) => {
      if (!editorUrl) {
        return "/editor";
      }
      if (editorUrl.startsWith("/")) {
        if (editorUrl.includes("//")) {
          return "/editor";
        }
        return editorUrl;
      }

      try {
        const baseUrl = new URL(BACKEND_BASE_URL);
        const parsedUrl = new URL(editorUrl, baseUrl);
        if (parsedUrl.origin !== baseUrl.origin) {
          return "/editor";
        }
        const path = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
        if (!path.startsWith("/") || path.includes("//")) {
          return "/editor";
        }
        return path;
      } catch (error) {
        return "/editor";
      }
    };

    const redirectPath = normalizeRedirectPath(data.editor_url);
    const handoffResult = await openAuthedPath(redirectPath);
    if (handoffResult?.status && handoffResult.status >= 400) {
      return handoffResult;
    }

    return { status: response.status, data };
  } catch (error) {
    return { error: error?.message || "unexpected_error" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type && !message?.action) {
    return false;
  }

  (async () => {
    try {
      debug("Incoming message", {
        type: message.type,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      });
      if (message.action === "open_panel") {
        const result = await toggleSidePanel(sender.tab?.id || null, sender.tab?.windowId || null);
        sendResponse(result);
        return;
      }

      switch (message.type) {
        case "login": {
          const { data } = await supabaseClient.auth.signInWithPassword({
            email: message.email,
            password: message.password,
          });
          await clearStorage([USAGE_KEY]);
          sendResponse({ session: data?.session || null });
          break;
        }
        case "signup": {
          const name = (message.name || "").trim();
          const useCase = (message.use_case || "").trim();
          if (!name) {
            sendResponse({ error: "Full name is required for signup." });
            break;
          }
          if (!useCase) {
            sendResponse({ error: "Use case is required for signup." });
            break;
          }

          const { data, error } = await supabaseClient.auth.signUp({
            email: message.email,
            password: message.password,
            options: {
              data: {
                name,
                use_case: useCase,
              },
            },
          });

          if (error) {
            sendResponse({ error: error.message || "Signup failed." });
            break;
          }

          const signupSyncResponse = await apiFetch("/api/signup", {
            method: "POST",
            body: JSON.stringify({
              name,
              email: message.email,
              password: message.password,
              use_case: useCase,
              user_id: data?.user?.id || null,
            }),
          });

          if (!signupSyncResponse.ok) {
            let detail = "Signup metadata sync failed";
            try {
              const payload = await signupSyncResponse.json();
              detail = payload?.detail || detail;
            } catch (error) {
              // ignore
            }
            sendResponse({ error: detail });
            break;
          }

          await clearStorage([USAGE_KEY]);
          sendResponse({ session: data?.session || null });
          break;
        }
        case "logout": {
          await clearSession();
          await clearStorage([USAGE_KEY, TIER_CACHE_KEY]);
          sendResponse({ success: true });
          break;
        }
        case "get-session": {
          const session = await ensureValidSession();
          const usage = await getUsageSnapshotForSession(session);
          if (usage) {
            await hydrateTierCacheFromUsage(usage, session);
          }
          const tierCache = await getTierCacheWithAutoReset();
          sendResponse({ session, usage, tier_cache: tierCache });
          break;
        }
        case "check-unlock": {
          const result = await fetchUnlockPermit({
            url: message.url || null,
          });
          sendResponse(result);
          break;
        }
        case "peek-unlock": {
          const result = await fetchUnlockPermit({
            url: message.url || null,
            dry_run: true,
          });
          sendResponse(result);
          break;
        }
        case "SAVE_CITATION": {
          const gate = await consumeTierCredit("citations");
          if (!gate.allowed) {
            sendResponse({
              status: 403,
              data: {
                detail: {
                  message: "Citation limit reached for current period.",
                  toast: "Citation limit reached. Upgrade your tier or wait for reset.",
                },
                tier_cache: gate.cache,
                local_gate: true,
              },
            });
            break;
          }

          const citationPayload = message.payload || {};
          try {
            const record = normalizeCitationRecord(citationPayload, {});
            await upsertResearchCitation(record);
          } catch (error) {
            debug("upsertResearchCitation failed", error);
          }
          startCitationSync(citationPayload);
          const localResult = { status: 200, data: { local_saved: true, sync_started: true, tier_cache: gate.cache } };
          debug("SAVE_CITATION result", localResult);
          sendResponse(localResult);
          break;
        }
        case "RENDER_CITATION": {
          const result = await renderCitation(message.payload || {});
          debug("RENDER_CITATION result", result);
          sendResponse(result);
          break;
        }
        case "GET_RECENT_CITATIONS": {
          const limit = Number.isFinite(message.limit) ? message.limit : 5;
          const safeLimit = Math.max(1, Math.min(5, limit));
          const result = await fetchRecentCitations(safeLimit);
          debug("GET_RECENT_CITATIONS result", result);
          sendResponse(result);
          break;
        }
        case "WORK_IN_EDITOR": {
          const gate = await consumeTierCredit("documents");
          if (!gate.allowed) {
            sendResponse({
              status: 403,
              error: "upgrade_required",
              data: {
                allowed: false,
                toast: "Document limit reached for your current tier.",
                tier_cache: gate.cache,
                local_gate: true,
              },
            });
            break;
          }
          const result = await workInEditor(message.payload || {});
          debug("WORK_IN_EDITOR result", result);
          sendResponse(result);
          break;
        }
        case "LOG_USAGE_EVENT": {
          const result = await logUsageEvent(message.payload || {});
          debug("LOG_USAGE_EVENT result", result);
          sendResponse(result);
          break;
        }
        case "OPEN_EDITOR": {
          const result = await openAuthedPath("/editor");
          debug("OPEN_EDITOR result", result);
          sendResponse(result);
          break;
        }
        case "OPEN_DASHBOARD": {
          const result = await openAuthedPath("/dashboard");
          debug("OPEN_DASHBOARD result", result);
          sendResponse(result);
          break;
        }

        case "NOTE_SAVE": {
          const session = await ensureValidSession();
          const usage = await getUsageSnapshotForSession(session);
          const accountType = usage?.account_type || "anonymous";
          const { note, state } = await upsertNote(message.note || {});
          const localSize = estimateSize(state.notes || []);
          const syncLimit = getSyncStorageLimitBytes(accountType, Boolean(session));
          const syncBlocked = Boolean(session) && localSize > syncLimit;
          if (session && !syncBlocked) {
            await enqueueSyncOperation({ type: "create", note });
            void flushSyncQueue();
          }
          try {
            await upsertResearchNote(note);
          } catch (error) {
            debug("upsertResearchNote failed", error);
          }
          sendResponse({ status: 200, data: { note, sync_blocked: syncBlocked, storage_bytes: localSize, sync_limit_bytes: Number.isFinite(syncLimit) ? syncLimit : null } });
          break;
        }
        case "NOTES_LIST": {
          const state = await getNotesState();
          const limit = Number.isFinite(message.limit) ? Math.max(1, Math.min(500, message.limit)) : 100;
          const notes = applyFilters(state.notes || [], state, message.filters || {}, message.sort || "desc").slice(0, limit);
          sendResponse({ status: 200, data: { notes, tags: state.tags || [], projects: state.projects || [] } });
          break;
        }
        case "NOTE_UPDATE": {
          const state = await getNotesState();
          const note = (state.notes || []).find((item) => item.id === message.id);
          if (!note) {
            sendResponse({ status: 404, error: "Note not found." });
            break;
          }
          const merged = { ...note, ...(message.patch || {}), id: note.id };
          const result = await upsertNote(merged);
          const session = await ensureValidSession();
          if (session) {
            await enqueueSyncOperation({ type: "update", note: result.note });
            void flushSyncQueue();
          }
          try {
            await upsertResearchNote(result.note);
          } catch (error) {
            debug("upsertResearchNote failed", error);
          }
          sendResponse({ status: 200, data: { note: result.note } });
          break;
        }
        case "NOTE_DELETE": {
          const state = await getNotesState();
          const notes = (state.notes || []).filter((item) => item.id !== message.id);
          if (notes.length === (state.notes || []).length) {
            sendResponse({ status: 404, error: "Note not found." });
            break;
          }
          await setNotesState({ ...state, notes });
          const session = await ensureValidSession();
          if (session) {
            await enqueueSyncOperation({ type: "delete", note: { id: message.id } });
            void flushSyncQueue();
          }
          try {
            await deleteResearchNote(message.id);
          } catch (error) {
            debug("deleteResearchNote failed", error);
          }
          sendResponse({ status: 200, data: { deleted: true } });
          break;
        }

        case "OPEN_SIDEPANEL": {
          const result = await openSidePanel(sender.tab?.id || null);
          sendResponse(result);
          break;
        }
        case "COLLAPSE_SIDEPANEL": {
          const result = await collapseSidePanel();
          sendResponse(result);
          break;
        }

        case "SET_LAST_SELECTION": {
          await setResearchLastSelection(message.text || "");
          sendResponse({ status: 200, data: { ok: true } });
          break;
        }
        case "GET_RESEARCH_STATE": {
          sendResponse({ status: 200, data: getResearchStateSnapshot() });
          break;
        }
        default:
          sendResponse({ error: "Unknown message type." });
      }
    } catch (error) {
      debug("Message handler error", error);
      sendResponse({ error: error.message || "Unexpected error." });
    }
  })();

  return true;
});
