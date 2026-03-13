import { apiFetch } from "./lib/api.js";
import { createSupabaseAuthClient } from "./lib/supabase.js";
import { BACKEND_BASE_URL } from "./config.js";

const USAGE_KEY = "usage_snapshot";
const NOTES_KEY = "notes_state";
const NOTES_SYNC_QUEUE_KEY = "notes_sync_queue";
const REFRESH_WINDOW_SECONDS = 120;
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

async function fetchUnlockPermit(payload) {
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


async function logUsageEvent(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/extension/usage-event",
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

async function saveCitation(payload) {
  const session = await ensureValidSession();
  if (!session) {
    return { error: "unauthenticated", status: 401 };
  }

  const response = await apiFetch(
    "/api/citations",
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
  if (!message?.type) {
    return false;
  }

  (async () => {
    try {
      debug("Incoming message", {
        type: message.type,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      });
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
          await clearStorage([USAGE_KEY]);
          sendResponse({ success: true });
          break;
        }
        case "get-session": {
          const session = await ensureValidSession();
          const usage = await getUsageSnapshotForSession(session);
          sendResponse({ session, usage });
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
          const result = await saveCitation(message.payload || {});
          debug("SAVE_CITATION result", result);
          sendResponse(result);
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
          sendResponse({ status: 200, data: { deleted: true } });
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
