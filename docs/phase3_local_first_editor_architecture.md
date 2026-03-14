# Phase 3 — Local-First Editor Architecture

## Implemented approach (incremental, repository-compatible)

The editor now uses a **local-first write path** layered on top of the existing API contract.

### Write lifecycle
1. User edits title/content/citations.
2. Editor immediately stages a local snapshot (`title`, `content_delta`, `content_html`, `citation_ids`).
3. Snapshot is marked `dirty` and UI shows **Saving locally**.
4. Background sync attempts to flush dirty documents to `/api/docs/{id}`.
5. On success: local entry is marked synced and UI shows **Synced** + last synced timestamp.
6. On failure: entry remains dirty, retry backoff is scheduled, UI shows **Sync failed**.

---

## Storage model

### Local state location
- **localStorage** key: `editor_local_docs_v1`
- Per-document entry includes:
  - `payload`
  - `dirty`
  - `status`
  - `updated_at`
  - `last_synced_at`
  - `retry_count`
  - `next_retry_at`

### In-memory runtime state
- `syncStateByDocId`: doc sync status cache for fast UI updates.
- `syncInFlightByDocId`: per-doc in-flight sync dedupe.
- `syncTimersByDocId`: scheduled retry/debounce timers.

---

## Pending changes tracking

Pending changes are tracked via `dirty: true` in local storage entries and reflected in memory cache.
- Dirty entries are discovered and flushed by periodic/background sync.
- Manual sync triggers an immediate flush of all dirty entries.

---

## Background sync + retry

### Automatic sync
- Immediate delayed sync after local stage (short debounce).
- Periodic global sync loop every ~8 seconds.
- Sync on browser `online` event.

### Retry behavior
- Failed sync increments `retry_count`.
- Exponential backoff is applied up to a capped delay.
- `next_retry_at` prevents hot-loop retries.

---

## Conflict handling

Current conflict policy is **pragmatic last-write-wins** with local unsynced priority in editor session:
- On document open, if a local entry is dirty, editor hydrates from local payload.
- Server write uses current local payload as source of truth.

This keeps user-visible edits stable under latency/offline conditions while preserving existing backend compatibility.

---

## Offline behavior

When offline:
- Edits continue to save locally.
- UI displays **Offline mode**.
- Sync attempts are skipped until connectivity returns.
- On reconnect, dirty entries are flushed automatically.

---

## Sync status UI

Added in editor header:
- **Synced**
- **Saving locally**
- **Syncing…**
- **Sync failed**
- **Offline mode**

Also added:
- **Sync now** (manual sync button)
- **Last synced** timestamp
