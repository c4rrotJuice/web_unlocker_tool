# Phase 13 — Final Integration Verification

## Verification scope
This phase verifies the integrated extension behavior across all implemented phases:

- always-active copy unlocking
- persistent side panel workspace
- floating assistant icon
- highlight quick actions
- cross-tab research state
- local-first interactions
- background synchronization
- tier gating
- SPA-safe lifecycle management

## Verification matrix

### 1) Always-active copy unlocking
- Verified by manifest persistent content script registration:
  - `matches: ["<all_urls>"]`
  - `js: ["content/unlock_content.js"]`
  - `run_at: "document_idle"`
- Copy unlock implementation remains in content script (`enableSelection`).

### 2) Persistent side panel workspace
- Verified by:
  - `side_panel.default_path = "sidepanel.html"`
  - side panel files present (`sidepanel.html`, `sidepanel.js`)
  - background open/collapse handlers

### 3) Floating assistant icon
- Verified in content script:
  - `#writior-floating-icon` injection
  - open panel message flow to background (`action: "open_panel"`)

### 4) Highlight quick actions
- Verified in content script quick action pill:
  - `Copy | Cite | Note` actions
  - selection-based pill rendering and cleanup

### 5) Cross-tab research state
- Verified in background:
  - shared `researchState`
  - IndexedDB stores (`notes`, `citations`)
  - `GET_RESEARCH_STATE` / `SET_LAST_SELECTION` messages

### 6) Local-first interactions
- Verified in background/content script:
  - local citation save response path
  - local usage snapshot dry-run path (`peek-unlock`)
  - non-blocking client flow for citation save invocation

### 7) Background synchronization
- Verified in background:
  - `background_sync_queue`
  - async `flushBackgroundSyncQueue()` worker
  - startup/install flush triggers

### 8) Tier gating
- Verified in background:
  - local `tier_cache`
  - `consumeTierCredit(...)`
  - local gate enforcement for `SAVE_CITATION` and `WORK_IN_EDITOR`

### 9) SPA-safe lifecycle management
- Verified in content script:
  - singleton `window.WRITIOR_EXTENSION`
  - `bootstrap()` + `cleanup()`
  - managed listeners/observers
  - SPA route detection via history hooks, mutation observer, and URL checks

## Automated checks added
- Added `tests/test_extension_phase13_integration.py` covering integration markers for:
  - manifest always-active + side panel wiring
  - content script singleton/root/SPA markers
  - background shared-state/sync/tier-gating markers
