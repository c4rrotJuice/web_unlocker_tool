# Writior Extension Phase 1 Architecture Report

## Current extension architecture

### Manifest and runtime entry points
- Manifest V3 extension using a module service worker (`background.js`) and popup action (`popup.html` + `popup.js`).
- Core permissions currently include `storage`, `activeTab`, and `scripting`.
- No persistent `content_scripts` registration exists in the current baseline; page capability is currently injected on demand from popup flow.

### Content script system
- Main page runtime is `extension/content/unlock_content.js`.
- It already includes a singleton guard (`window.__webUnlockerContentScriptInjected`) to avoid duplicate mount on reinjection.
- On mount it:
  - injects styles
  - enables selection/copy context by stopping restrictive page handlers
  - installs highlight detection and contextual quick actions (`Copy`, `Cite`, `Note`)
  - builds citation popup and note modal
  - communicates with background via `chrome.runtime.sendMessage`

### Popup UI architecture
- Popup is the user-facing control center for auth/session, usage display, quick notes list/filtering, and citations history.
- The popup currently provides manual page activation through **Enable Copy + Cite on this page**.
- Manual activation path:
  1. popup calls `check-unlock` in background
  2. if allowed, popup injects `content/unlock_content.js` via `chrome.scripting.executeScript`
  3. success toast/status shown in popup

### Background/service worker architecture
- `background.js` handles:
  - auth/session bridge to Supabase-backed APIs
  - usage checks (`check-unlock`, `peek-unlock`)
  - citation save/render/history requests
  - note CRUD and local-first queue for sync
  - opening editor/dashboard flows
- Notes state is persisted in `chrome.storage.local` and normalized/migrated in background.

### Messaging bridge
- Content script and popup both communicate with background over typed runtime messages.
- Content script wraps messaging in a resilient `sendMessage(type, payload)` helper and handles extension-context invalidation errors gracefully.

### Storage/state map
- `chrome.storage.local`:
  - usage snapshots
  - notes state (`notes_state`)
  - note sync queue (`notes_sync_queue`)
  - debug toggles and popup UI state
- In-memory state:
  - content script selection, citation format, temporary UI state
  - background ephemeral process state during message handling
- Backend APIs:
  - unlock permit/usage
  - citation render/save/history
  - notes sync and auth/session dependent operations
- `localStorage`:
  - debug toggle in content script (`webUnlockerDebug`) only
- IndexedDB:
  - not currently used in extension runtime

### Citation and highlight logic
- Citation metadata extraction is advanced and local-first in content script:
  - meta tags, JSON-LD parsing, source classification, date parsing, author normalization
  - local format fallback + server render augmentation
- Highlight detection:
  - selection on mouseup
  - computes selection rect
  - injects contextual quick-action pill
  - handles repositioning on scroll/resize

### Copy unlock logic
- Copy unlock is implemented client-side by overriding/neutralizing restrictive event handlers and enforcing `user-select: text` via injected style.
- This unlock behavior is independent of paid gating and should remain always available.

## Lifecycle safety analysis

### Existing safeguards
- Content singleton guard prevents duplicate mount on repeated injection.
- Popup/modal cleanup exists for close actions.
- Copy action pill avoids repeated creation via `copyButton` reference.

### Risks found
- Reposition listeners are added once and never removed (minor leak risk on long-lived tabs).
- Broad `* { user-select: text !important; }` may be invasive on some web apps.
- No explicit SPA route-change handling in content script for page metadata refresh.
- No unified root mount container (multiple top-level injected nodes are appended directly).

## Best integration points for new roadmap

1. **Phase 2 always-active enablement**: manifest-level persistent content script registration is the most compatible path (minimal code churn, preserves existing content behavior).
2. **Phase 3 side panel migration**: keep popup business logic as source of truth and progressively move UI sections to `sidepanel.html` reusing existing message contracts.
3. **Phase 4 floating assistant icon**: add to existing content script UI module alongside quick-action pill lifecycle.
4. **Phase 7 shared state**: background message handlers already centralize operations; this is the natural seam for cross-tab canonical research state.
5. **Phase 11 lifecycle hardening**: extend existing singleton model with explicit bootstrap/cleanup registries and a single root container without rewriting citation/note pipelines.

## Architectural decision for Phase 2

- Prefer **manifest `content_scripts`** over popup-driven `executeScript` so unlock + highlight stack becomes automatic on every supported page.
- Keep popup button as compatibility affordance, but repurpose from injector to informational/validation action during transition.
# Historical document — describes transitional rebuild state.
# Do not use as operational or implementation guidance.
