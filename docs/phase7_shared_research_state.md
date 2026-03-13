# Phase 7 — Shared Research State (Cross-Tab)

## What was implemented

A background-owned shared `researchState` model was added and hydrated from IndexedDB:

```js
researchState = {
  notes: [],
  citations: [],
  lastSelection: "",
}
```

## Storage strategy

- **IndexedDB** (`writior_research_state`)
  - `notes` object store keyed by `id`
  - `citations` object store keyed by `id`
- **chrome.storage.local**
  - `research_last_selection` for lightweight selection state/config

## Runtime flow

- Background hydrates `researchState` on startup from IndexedDB + storage.
- On `NOTE_SAVE` and `NOTE_UPDATE`, note records are upserted into IndexedDB and in-memory state.
- On `NOTE_DELETE`, note records are removed from IndexedDB and in-memory state.
- On `SAVE_CITATION` success, citation records are normalized and persisted to IndexedDB + in-memory state.
- Content script sends `SET_LAST_SELECTION` to background whenever selection changes.

## Message APIs added

- `SET_LAST_SELECTION` — updates `researchState.lastSelection` and persists to storage.
- `GET_RESEARCH_STATE` — returns a snapshot of `{ notes, citations, lastSelection }`.

## Outcome

Research data is now maintained in a background shared state and persisted with IndexedDB for structured records, enabling continuity across tabs and service worker restarts.
