import { buildCanonicalNotePayloadBase } from "../lib/note_sync.js";
import { getRecord, putRecord } from "../storage/local_db.js";
import { setRemoteId, getRemoteId, getRemoteIdByIdempotency } from "../storage/reconciliation.js";
import { createLogger } from "../shared/log.js";

const logger = createLogger("background:sync");

function nextAttemptDelay(attemptCount) {
  const base = Math.min(60_000, 2 ** Math.min(attemptCount, 6) * 1000);
  return Date.now() + base;
}

async function recordActivity(entry) {
  await putRecord("activity", {
    id: entry.id,
    ...entry,
    updated_at: new Date().toISOString(),
  });
}

function resolveResponseId(response) {
  return response?.data?.id || response?.id || response?.data?.remote_id || response?.remote_id || null;
}

function storeNameForType(type) {
  if (type === "capture_citation") return "citations";
  if (type === "capture_quote") return "quotes";
  if (type === "capture_note") return "notes";
  return null;
}

async function updateLocalSyncState(item, syncState, extra = {}) {
  const storeName = storeNameForType(item.type);
  if (!storeName || !item.local_id) return;
  const localRecord = await getRecord(storeName, item.local_id);
  if (!localRecord) return;
  await putRecord(storeName, {
    ...localRecord,
    sync_status: syncState,
    last_error: extra.last_error === undefined ? localRecord.last_error || null : extra.last_error,
    next_attempt_at: extra.next_attempt_at === undefined ? localRecord.next_attempt_at || null : extra.next_attempt_at,
    remote_id: extra.remote_id === undefined ? localRecord.remote_id || null : extra.remote_id,
    updated_at: new Date().toISOString(),
  });
}

async function markReconciled(item, remoteId) {
  if (!remoteId) {
    throw new Error("remote_id_missing");
  }
  const kind = item.type === "capture_citation" ? "citations" : item.type === "capture_quote" ? "quotes" : "notes";
  await setRemoteId(kind, item.local_id, remoteId, { idempotency_key: item.idempotency_key });
  await updateLocalSyncState(item, "synced", {
    remote_id: remoteId,
    last_error: null,
    next_attempt_at: null,
  });
}

async function resolveExistingRemoteId(item) {
  const kind = item.type === "capture_citation" ? "citations" : item.type === "capture_quote" ? "quotes" : item.type === "capture_note" ? "notes" : null;
  if (!kind) return null;
  return (await getRemoteId(kind, item.local_id)) || (await getRemoteIdByIdempotency(kind, item.idempotency_key));
}

export function createSyncManager({ apiClient, queueManager, sessionManager }) {
  let flushInFlight = null;

  async function syncCitation(item) {
    const response = await apiClient.captureCitation(item.payload, { idempotencyKey: item.idempotency_key });
    await markReconciled(item, resolveResponseId(response));
  }

  async function syncQuote(item) {
    const payload = { ...item.payload };
    if (!payload.citation_id && item.payload.citation_local_id) {
      payload.citation_id = await getRemoteId("citations", item.payload.citation_local_id);
    }
    if (!payload.citation_id) {
      throw new Error("citation_dependency_pending");
    }
    delete payload.citation_local_id;
    const response = await apiClient.captureQuote(payload, { idempotencyKey: item.idempotency_key });
    await markReconciled(item, resolveResponseId(response));
  }

  async function syncNote(item) {
    const note = item.payload.note || item.payload;
    const payload = buildCanonicalNotePayloadBase(note, {
      project_id: item.payload.project_id || null,
      tag_ids: Array.isArray(item.payload.tag_ids) ? item.payload.tag_ids : [],
    });
    if (!payload.citation_id && item.payload.citation_local_id) {
      payload.citation_id = await getRemoteId("citations", item.payload.citation_local_id);
    }
    if (!payload.quote_id && item.payload.quote_local_id) {
      payload.quote_id = await getRemoteId("quotes", item.payload.quote_local_id);
    }
    if (item.payload.citation_local_id && !payload.citation_id) {
      throw new Error("citation_dependency_pending");
    }
    if (item.payload.quote_local_id && !payload.quote_id) {
      throw new Error("quote_dependency_pending");
    }
    const response = await apiClient.captureNote(payload, { idempotencyKey: item.idempotency_key });
    await markReconciled(item, resolveResponseId(response));
  }

  async function syncUsageEvent(item) {
    await apiClient.usageEvent(item.payload);
  }

  async function flush() {
    if (flushInFlight) return flushInFlight;
    flushInFlight = (async () => {
      try {
        await sessionManager.ensureSession({ allowMissing: false });
      } catch (error) {
        const items = await queueManager.readyForReplay();
        await Promise.all(items.map(async (item) => {
          await queueManager.mark(item, { status: "auth_needed" });
          await updateLocalSyncState(item, "auth_needed", { last_error: "auth_required" });
        }));
        return { ok: false, error: "auth_required" };
      }

      const items = await queueManager.readyForReplay();
      for (const item of items) {
        try {
          const existingRemoteId = await resolveExistingRemoteId(item);
          if (existingRemoteId) {
            await markReconciled(item, existingRemoteId);
            await recordActivity({ id: `activity_${item.id}`, type: item.type, status: "synced", recovered: true });
            await queueManager.remove(item.id);
            continue;
          }
          await queueManager.mark(item, { status: "syncing", last_error: null });
          await updateLocalSyncState(item, "syncing", { last_error: null, next_attempt_at: null });
          if (item.type === "capture_citation") await syncCitation(item);
          else if (item.type === "capture_quote") await syncQuote(item);
          else if (item.type === "capture_note") await syncNote(item);
          else if (item.type === "usage_event") await syncUsageEvent(item);
          await recordActivity({ id: `activity_${item.id}`, type: item.type, status: "synced" });
          await queueManager.remove(item.id);
        } catch (error) {
          logger.warn("Queue replay failed", { type: item.type, error: error?.message, status: error?.status });
          if (error?.status === 401) {
            await queueManager.mark(item, { status: "auth_needed", last_error: "auth_required" });
            await updateLocalSyncState(item, "auth_needed", { last_error: "auth_required" });
            continue;
          }
          if (error?.message === "citation_dependency_pending" || error?.message === "quote_dependency_pending") {
            await queueManager.mark(item, { status: "retry", last_error: error.message });
            await updateLocalSyncState(item, "queued", { last_error: error.message });
            continue;
          }
          const status = error?.status && error.status < 500 ? "failed" : "retry";
          const nextAttemptAt = status === "retry" ? new Date(nextAttemptDelay((item.attempt_count || 0) + 1)).toISOString() : null;
          await queueManager.mark(item, {
            status,
            last_error: error?.message || "sync_failed",
            attempt_count: (item.attempt_count || 0) + 1,
            next_attempt_at: nextAttemptAt,
          });
          await updateLocalSyncState(item, status === "retry" ? "failed_retryable" : "failed", {
            last_error: error?.message || "sync_failed",
            next_attempt_at: nextAttemptAt,
          });
          await recordActivity({ id: `activity_${item.id}`, type: item.type, status, error: error?.message || "sync_failed" });
        }
      }
      return { ok: true };
    })().finally(() => {
      flushInFlight = null;
    });
    return flushInFlight;
  }

  return { flush };
}
