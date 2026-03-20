import { MESSAGE_TYPES } from "../shared/messages.js";
import { createLocalId } from "../shared/models.js";
import { putRecord, deleteRecord, getRecord } from "../storage/local_db.js";

export function createRouter(deps) {
  const {
    apiClient,
    sessionManager,
    capabilityCache,
    queueManager,
    syncManager,
    handoffManager,
    sidepanelManager,
    workspaceSummary,
  } = deps;

  async function buildStatus() {
    const [session, capabilities, sidepanel, summary] = await Promise.all([
      sessionManager.getPublicSessionState(),
      capabilityCache.summarize(),
      sidepanelManager.getState(),
      workspaceSummary.getSummary(),
    ]);
    return {
      ok: true,
      data: {
        session,
        capabilities,
        sidepanel,
        sync: summary.queue,
      },
    };
  }

  async function persistLocalCitation(payload) {
    const id = payload.local_id || createLocalId("citation");
    await putRecord("citations", {
      id,
      url: payload.url,
      metadata: payload.metadata || {},
      excerpt: payload.excerpt || null,
      quote: payload.quote || null,
      locator: payload.locator || {},
      sync_status: "queued",
      last_error: null,
      next_attempt_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return id;
  }

  async function persistLocalQuote(payload) {
    const id = payload.local_id || createLocalId("quote");
    await putRecord("quotes", {
      id,
      citation_local_id: payload.citation_local_id || null,
      quote_text: payload.quote_text || payload.text || "",
      comment: payload.comment || null,
      locator: payload.locator || {},
      sync_status: "queued",
      last_error: null,
      next_attempt_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return id;
  }

  async function persistLocalNote(payload) {
    const note = payload.note || payload;
    const id = note.id || createLocalId("note");
    await putRecord("notes", {
      ...note,
      id,
      sync_status: "queued",
      last_error: null,
      next_attempt_at: null,
      created_at: note.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return id;
  }

  async function handleCaptureCitation(message) {
    const localId = await persistLocalCitation(message.payload);
    await queueManager.enqueue("capture_citation", message.payload, {
      local_id: localId,
      priority: 10,
      idempotency_key: message.payload.idempotency_key,
    });
    await queueManager.enqueue("usage_event", {
      url: message.payload.url,
      event_id: createLocalId("usage"),
      event_type: "selection_capture",
      was_cleaned: true,
    }, {
      priority: 90,
    });
    void syncManager.flush();
    return { ok: true, data: { local_id: localId, sync_status: "queued" } };
  }

  async function handleCaptureQuote(message) {
    const localId = await persistLocalQuote(message.payload);
    await queueManager.enqueue("capture_quote", { ...message.payload }, {
      local_id: localId,
      depends_on: message.payload.citation_local_id ? [{ kind: "citation", local_id: message.payload.citation_local_id }] : [],
      priority: 20,
      idempotency_key: message.payload.idempotency_key,
    });
    void syncManager.flush();
    return { ok: true, data: { local_id: localId, sync_status: "queued" } };
  }

  async function handleCaptureNote(message) {
    const localId = await persistLocalNote(message.payload);
    const dependencies = [];
    if (message.payload.citation_local_id) dependencies.push({ kind: "citation", local_id: message.payload.citation_local_id });
    if (message.payload.quote_local_id) dependencies.push({ kind: "quote", local_id: message.payload.quote_local_id });
    await queueManager.enqueue("capture_note", { ...message.payload, note: { ...(message.payload.note || {}), id: localId } }, {
      local_id: localId,
      depends_on: dependencies,
      priority: 30,
      idempotency_key: message.payload.idempotency_key,
    });
    void syncManager.flush();
    return { ok: true, data: { local_id: localId, sync_status: "queued" } };
  }

  async function handleCopyAssist(message) {
    await queueManager.enqueue("usage_event", {
      url: message.payload?.url || "",
      event_id: createLocalId("usage"),
      event_type: "copy_assist",
      was_cleaned: true,
    }, {
      priority: 90,
    });
    void syncManager.flush();
    return { ok: true };
  }

  async function handleWorkInEditor(message) {
    try {
      return await handoffManager.workInEditor(message.payload);
    } catch (error) {
      const isOfflineFailure =
        typeof navigator !== "undefined" && navigator && "onLine" in navigator
          ? navigator.onLine === false
          : !error?.status;
      if (isOfflineFailure) {
        const draftId = createLocalId("editor_draft");
        await putRecord("captures", {
          id: draftId,
          type: "work_in_editor_draft",
          payload: message.payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { ok: false, offline: true, data: { draft_id: draftId } };
      }
      throw error;
    }
  }

  async function handleResumeEditorDraft(message) {
    const draft = await getRecord("captures", message.payload.id);
    if (!draft || draft.type !== "work_in_editor_draft") {
      return { ok: false, error: "draft_not_found", status: 404 };
    }
    const result = await handoffManager.workInEditor(draft.payload || {});
    await deleteRecord("captures", draft.id);
    return { ok: true, data: { draft_id: draft.id, resumed: true, result } };
  }

  return async function routeMessage(message, sender) {
    switch (message?.type) {
      case MESSAGE_TYPES.GET_STATUS:
        return buildStatus();
      case MESSAGE_TYPES.GET_WORKSPACE_SUMMARY:
        return { ok: true, data: await workspaceSummary.getSummary() };
      case MESSAGE_TYPES.GET_CAPTURE_STATE:
        return { ok: true, data: { current_tab_id: sender?.tab?.id || null } };
      case MESSAGE_TYPES.OPEN_SIDEPANEL:
        return sidepanelManager.openSidePanel(sender?.tab?.id || null, sender?.tab?.windowId || null);
      case MESSAGE_TYPES.OPEN_APP_SIGN_IN:
        return handoffManager.openAppSignIn();
      case MESSAGE_TYPES.OPEN_DASHBOARD:
        await chrome.tabs.create({ url: "https://app.writior.com/dashboard" });
        return { ok: true };
      case MESSAGE_TYPES.AUTH_RESTORE:
        {
          const restored = await handoffManager.restoreAuthSession(message.payload || {});
          const sync = await syncManager.flush();
          return {
            ok: Boolean(restored?.ok && sync?.ok !== false),
            data: {
              ...(restored?.data || {}),
              sync: sync || { ok: true },
            },
            error: restored?.ok ? (sync?.ok === false ? sync?.error || "auth_required" : null) : (restored?.error || "handoff_restore_failed"),
          };
        }
      case MESSAGE_TYPES.LOGOUT:
        await sessionManager.logout();
        return { ok: true };
      case MESSAGE_TYPES.CAPTURE_CITATION:
        return handleCaptureCitation(message);
      case MESSAGE_TYPES.CAPTURE_QUOTE:
        return handleCaptureQuote(message);
      case MESSAGE_TYPES.CAPTURE_NOTE:
        return handleCaptureNote(message);
      case MESSAGE_TYPES.COPY_ASSIST:
        return handleCopyAssist(message);
      case MESSAGE_TYPES.WORK_IN_EDITOR:
        return handleWorkInEditor(message);
      case MESSAGE_TYPES.SYNC_NOW:
        return syncManager.flush();
      case MESSAGE_TYPES.SET_CAPTURE_DRAFT:
        await putRecord("captures", { id: message.payload.id, ...message.payload, updated_at: new Date().toISOString() });
        return { ok: true };
      case MESSAGE_TYPES.CLEAR_CAPTURE_DRAFT:
        await deleteRecord("captures", message.payload.id);
        return { ok: true };
      case MESSAGE_TYPES.RESUME_EDITOR_DRAFT:
        return handleResumeEditorDraft(message);
      case MESSAGE_TYPES.REMOVE_LOCAL_DRAFT:
        await deleteRecord("captures", message.payload.id);
        return { ok: true };
      default:
        return { ok: false, error: "unknown_message_type" };
    }
  };
}
