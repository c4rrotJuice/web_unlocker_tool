# Phase 9 — Background Synchronization

## Objective
Ensure server communication happens asynchronously in the background service worker, while UI interactions remain local-first.

## Implemented synchronization responsibilities

### Authentication validation
- Remote sync workers call `ensureValidSession()` before dispatching queued operations.
- On `401`, session is cleared and operations remain queued for retry.

### Usage counter updates (async)
- `LOG_USAGE_EVENT` now enqueues a `usage_event` sync operation and returns immediate `202` ack.
- Background flush worker processes the queue asynchronously.

### Citation synchronization (async)
- `SAVE_CITATION` remains local-first and immediately returns success to caller.
- Citation server sync is enqueued as `citation` operation and flushed asynchronously.

### Note synchronization (async)
- Existing note sync queue (`notes_sync_queue`) remains background-managed and async.
- Flush is triggered on startup/install for resilience after worker restarts.

## Queue model

### `background_sync_queue` (chrome.storage.local)
- Operation types:
  - `citation`
  - `usage_event`
- Worker:
  - `flushBackgroundSyncQueue()`
- Behavior:
  - retries failed operations
  - preserves queue on non-OK responses
  - pauses on auth failures

## Security boundary
- Content scripts continue to communicate via runtime messaging only.
- Backend endpoints/tokens remain in background code paths; no backend secrets are embedded in content scripts.
# Historical document — describes transitional rebuild state.
# Do not use as operational or implementation guidance.
