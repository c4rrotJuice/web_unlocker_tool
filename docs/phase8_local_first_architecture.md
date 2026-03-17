# Phase 8 — Local-First Architecture

## Goal
Ensure extension interactions execute locally first and never block UI on server round-trips.

## Implemented local-first behavior

### 1) Citation capture (`SAVE_CITATION`)
- **Immediate local path**:
  - Citation is normalized and stored locally in shared research state + IndexedDB.
  - Background responds success immediately (`local_saved`, `sync_started`).
- **Async remote path**:
  - Server citation sync is started in background (`startCitationSync`) and does not block UI.

### 2) Usage checks (`peek-unlock` / dry run)
- **Immediate local path**:
  - If a cached usage snapshot exists, return it immediately with `local_first: true`.
- **Async remote path**:
  - Trigger background refresh to `/api/extension/unlock-permit` without blocking caller.
- **Fallback**:
  - If no local snapshot exists, perform remote request.

### 3) Highlight capture flow
- Selection capture and quick-action pill behavior remain fully local in content script.
- Selection state (`lastSelection`) is pushed to background storage asynchronously.

### 4) Note creation flow
- Notes are created locally first (`NOTE_SAVE`), persisted in local storage/IndexedDB, and remote sync remains background async.

## Result
UI actions are now resilient and responsive even during backend latency/intermittent failures because core interaction paths complete locally first.
# Historical document — describes transitional rebuild state.
# Do not use as operational or implementation guidance.
