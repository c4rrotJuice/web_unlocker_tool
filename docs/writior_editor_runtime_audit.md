# Historical document — describes transitional rebuild state.
# Do not use as operational or implementation guidance.

# Writior Editor Runtime Audit

## Executive summary

This audit is based on direct inspection of the current `/editor` implementation in `app/templates/editor.html`, `app/static/js/editor.js`, `app/routes/editor.py`, `app/routes/extension.py`, `app/routes/citations.py`, and `app/services/research_entities.py`.

The strongest verified hypotheses are:

1. **Slow initial population is primarily a boot-order problem, not a Quill construction problem.**
   The page verifies access, initializes Quill early, then blocks initial document open behind a sequential chain of `loadHeaderData()`, `loadDocsList()`, `loadProjects()`, `loadNotes()`, and `loadCitationLibrary()` before it calls `openDoc()` (`app/static/js/editor.js:2030-2045`). Quill is available before most data loads, but the first real document content is delayed by unrelated side-panel fetches.

2. **The documents sidebar likely overfetches enough data to materially slow cold start.**
   `/api/docs` selects `content_delta` and `content_html` for every document (`app/routes/editor.py:837-845`), and `loadDocsList()` stores that entire payload into `allDocs` before rendering the list (`app/static/js/editor.js:697-706`). The list UI only uses title, timestamps, archive state, id, and export capabilities.

3. **Panel and sidebar interactions likely stall because major regions are fully rebuilt, with fresh listeners, for each update.**
   `renderDocs()`, `renderNotes()`, `renderResearchNotes()`, `renderAttachNoteList()`, `renderQuickNoteLinkList()`, `loadCitationLibrary()`, `refreshInDocCitations()`, `loadDocNotes()`, `renderCheckpoints()`, and `buildAndRenderOutline()` all clear their container and rebuild children from scratch (`app/static/js/editor.js:709-744`, `820-844`, `864-880`, `1081-1111`, `1350-1385`, `1442-1644`, `1647-1680`, `1694-1738`).

4. **UI-state complexity comes from several overlapping state systems rather than any single hard problem.**
   `editor.js` keeps document state simultaneously in closure locals, `localStorage`, per-doc sync maps, request sequence counters, render caches, and DOM classes (`app/static/js/editor.js:34-88`, `274-404`, `563-668`, `932-935`, `1893-1913`).

5. **Cursor and focus reliability depends on a fragile recovery path.**
   Panel actions move focus to buttons in sidebars and modals. Editor insertion relies on `lastKnownRange` plus forced `quill.focus()` and `quill.setSelection()` in `getInsertionIndex()` (`app/static/js/editor.js:947-964`). That makes insertion resilient in many cases, but it also means stale selection state or rerender timing can produce cursor jumps.

6. **The save/sync path is locally resilient but duplicates truth and likely causes avoidable rerenders.**
   Autosave writes a full document payload to `localStorage`, updates in-memory sync state, and rerenders the documents list on every dirty flush (`app/static/js/editor.js:345-404`, `563-582`). Background sync then re-fetches the full serialized document response and rerenders the list again (`app/static/js/editor.js:585-657`).

## Files analyzed

- `app/templates/editor.html`
  Static shell, DOM regions, modal markup, script load order, and Quill container definitions.
- `app/static/js/editor.js`
  All client boot, state, rendering, panel behavior, autosave/sync, and event registration live here.
- `app/routes/editor.py`
  `/editor`, `/api/editor/access`, document CRUD, checkpoint, restore, doc-note, and export routes.
- `app/routes/extension.py`
  Notes and projects APIs used by the editor notes surfaces.
- `app/routes/citations.py`
  Citation listing, by-id hydration, and render endpoints used by citation panels and insertion.
- `app/services/research_entities.py`
  Document-citation and document-tag hydration helpers.

## Boot sequence and control flow

### HTML and script bootstrap order

`/editor` is served by `editor_page()` and returns the static template after auth and account-type lookup (`app/routes/editor.py:719-726`).

The template defines all editor, sidebar, sidecar, and modal DOM up front (`app/templates/editor.html:27-329`), then loads scripts in this order:

1. `quill.js`
2. `@supabase/supabase-js`
3. `ui_feedback.js`
4. `auth.js`
5. `theme.js`
6. `editor.js`

Source: `app/templates/editor.html:331-336`.

There is also an inline theme bootstrap in `<head>` that mutates `<html>` before paint (`app/templates/editor.html:11-24`).

### Entry path

`editor.js` immediately runs:

1. `verifyEditorAccess()`
2. `startEditor()` if access passes

Source: `app/static/js/editor.js:2056-2058`.

`verifyEditorAccess()` performs `GET /api/editor/access`, may redirect to `/auth`, may replace the whole `<body>` with a blocked message, and stores the result in `window.__editorAccess` (`app/static/js/editor.js:6-23`, `26-31`).

### Quill initialization timing

`startEditor()`:

1. Captures DOM references
2. Registers button-click motion listeners on `document`
3. Registers Quill font/size/line-height formats
4. Constructs `new Quill("#editor", ...)`
5. Applies default formatting silently
6. Defines all helper functions
7. Registers all listeners
8. Runs the async init IIFE

Quill itself is initialized early in `startEditor()` at `app/static/js/editor.js:204-241`, before any network fetch in the init IIFE at `app/static/js/editor.js:2030-2052`.

### Work before first usable document interaction

Verified boot order inside the init IIFE:

1. `await loadHeaderData()`
2. `await loadDocsList()`
3. `await loadProjects()`
4. `await loadNotes()`
5. `await loadCitationLibrary()`
6. restore left-tab selection
7. close sidecar
8. resolve initial doc id
9. `await openDoc(initialDocId or allDocs[0].id)`
10. update sync UI
11. start background sync interval
12. `await syncAllDirtyDocs()`

Source: `app/static/js/editor.js:2030-2052`.

This means the first real document open is gated by four non-editor fetches plus one citation-library fetch.

### Initialization dependency graph

```text
/editor HTML
  -> editor.js
    -> verifyEditorAccess()
      -> /api/editor/access
      -> window.__editorAccess
    -> startEditor()
      -> DOM query/cache
      -> Quill registration
      -> new Quill("#editor")
      -> register listeners
      -> init IIFE
         -> loadHeaderData()
            -> /api/me
         -> loadDocsList()
            -> /api/docs
            -> renderDocs()
            -> renderFreeQuota()
         -> loadProjects()
            -> /api/projects
            -> renderProjects()
         -> loadNotes()
            -> /api/notes?...filters
            -> renderNotes()
            -> renderResearchNotes()
         -> loadCitationLibrary()
            -> /api/citations?...search
            -> buildCitationCard() x N
         -> setContentTab()
            -> loadNotes() again if default tab is notes
         -> openDoc(docId)
            -> autosaveDoc() pending previous doc
            -> /api/docs/{doc_id}
            -> local dirty overlay
            -> quill.setContents()/dangerouslyPasteHTML()
            -> updateWordCount()
            -> buildAndRenderOutline()
            -> Promise.allSettled(
                 loadDocNotes() -> /api/docs/{doc_id}/notes,
                 refreshInDocCitations() -> maybe /api/citations/by_ids,
                 loadCheckpoints() -> /api/docs/{doc_id}/checkpoints
               )
         -> sync interval start
         -> syncAllDirtyDocs()
```

### Boot cost classification

| Path | Classification | Trigger | Immediate cost | Scaling factor | Duplication attribution |
| --- | --- | --- | --- | --- | --- |
| `verifyEditorAccess()` | Boot | page load | 1 network roundtrip before editor init | constant | distinct but mandatory |
| `loadHeaderData()` | Boot | init IIFE | `/api/me` plus several DOM writes | constant | overlaps conceptually with access/account data already fetched |
| `loadDocsList()` | Boot | init IIFE | `/api/docs`, full payload into memory, full sidebar rebuild | grows with document count and document body size | duplicates later `/api/docs/{id}` fetch |
| `loadProjects()` | Boot | init IIFE | `/api/projects`, full project-list rebuild | grows with project count | no immediate duplication, but not required for first edit |
| `loadNotes()` | Boot | init IIFE | `/api/notes`, full note-list rebuild, research-note rebuild | grows with note count and note body size | same `allNotes` also powers attach modal and quick-link list |
| `loadCitationLibrary()` | Boot | init IIFE | `/api/citations`, card build + listeners | grows with citation count | in-doc citations are hydrated again separately |
| `openDoc()` | Boot then interaction | initial doc resolution or doc click | `/api/docs/{id}`, Quill population, outline build, doc-note/citation/checkpoint hydrate | grows with active doc size and sidecar data | duplicates content already sent by `/api/docs` |

## State architecture map

### Main state holders

The editor keeps most state in closure variables declared near the top of `startEditor()` (`app/static/js/editor.js:53-88`).

#### Active document and editor state

- `currentDocId`
- `currentAttachedCitationIds`
- `isDirty`
- `lastCheckpointAt`
- `changedSinceCheckpoint`
- `lastKnownRange`

#### Data collections

- `allDocs`
- `allProjects`
- `allNotes`
- `citationCache`
- `citationRenderCache`

#### UI and transient workflow state

- `selectedCitationId`
- `editingNoteId`
- `editingNoteFocusField`
- `editingNoteDraft`
- `noteAttachContext`
- `quickNoteSourcesDraft`
- `quickNoteLinkedNoteIdsDraft`

#### Request sequencing and in-flight dedupe

- `autosaveRequestSeq`
- `latestAppliedSaveSeq`
- `openDocRequestSeq`
- `citationLoadRequestSeq`
- `notesLoadRequestSeq`
- `docNotesLoadRequestSeq`
- `actionInFlight`
- `inFlightRequestCache`

#### Persistence and sync state

- `LOCAL_DOC_STATE_KEY` in `localStorage`
- `syncStateByDocId`
- `syncTimersByDocId`
- `syncInFlightByDocId`
- `syncIntervalHandle`

### Transient vs persistent state

Persistent across reload:

- local dirty document payloads in `localStorage` via `readLocalDocState()` and `writeLocalDocState()` (`app/static/js/editor.js:274-290`)
- left sidebar tab selection via `localStorage.setItem("editor_left_content_tab", tab)` (`app/static/js/editor.js:1822-1833`)
- diagnostics flag via `localStorage.editor_debug`

Transient in-memory only:

- current selection/cursor memory
- note editing draft
- selected citation
- all fetched notes/projects/docs
- request sequence counters
- render caches

### Selection and cursor tracking

- `selection-change` updates `lastKnownRange` and highlights active paragraph (`app/static/js/editor.js:1909-1913`)
- insertion functions call `getInsertionIndex()`, which:
  - prefers current `quill.getSelection()`
  - otherwise reuses `lastKnownRange`
  - otherwise moves to document end
  - explicitly focuses Quill and calls `setSelection()`

Source: `app/static/js/editor.js:947-964`.

This is a verified cursor recovery mechanism. The hypothesis is that focus loss during sidebar actions is being papered over here rather than structurally prevented.

### State duplication and hidden coupling

Verified duplicate truths:

- Dirty state exists in `isDirty`, per-doc local storage entries, and `syncStateByDocId`.
- Attached citation state exists in `currentAttachedCitationIds`, local dirty payloads, and serialized server docs.
- Note/project relationships are derived ad hoc from `allNotes` and `allProjects` during rendering instead of being normalized once.
- Selected citation exists both in `selectedCitationId` and in DOM `.selected` classes.
- Active paragraph state exists only as DOM class and selection-derived behavior, not in explicit state.

Hidden coupling examples:

- `renderResearchNotes()` filters using `allNotes` and derives `docProjectIds` from all notes, not from current document metadata (`app/static/js/editor.js:1649-1658`). That makes the research panel dependent on global note state rather than document state.
- `openAttachNoteModal()` assumes `allNotes` is already suitable for attachment search and only fetches notes if `allNotes.length` is zero (`app/static/js/editor.js:1387-1393`).
- Note editing, research panel, quick-note linking, and attach-note modal all silently depend on the same `allNotes` freshness.

## Hydration and data flow map

### Document load/populate flow

1. `loadDocsList()` fetches `/api/docs` and stores the full serialized array in `allDocs` (`app/static/js/editor.js:697-706`).
2. `openDoc()` fetches `/api/docs/{id}` anyway (`app/static/js/editor.js:771-782`).
3. If a dirty local entry exists, it overlays server fields (`app/static/js/editor.js:788-797`).
4. Quill is populated with either `content_delta` or `content_html` (`app/static/js/editor.js:803-805`).
5. Metrics and outline are rebuilt immediately (`app/static/js/editor.js:809-810`).
6. Doc notes, doc citations, and checkpoints load in parallel (`app/static/js/editor.js:811`).

Verified hypothesis: document content is hydrated at least twice at boot for the initial document if `/api/docs` already carried the same body.

### Citation hydration flow

Library:

1. `loadCitationLibrary(search)` -> `fetchCitations({ search, limit: 50 })`
2. `/api/citations`
3. each record inserted into `citationCache`
4. full card rebuild for `#citations-list`

Source: `app/static/js/editor.js:906-913`, `1081-1099`.

In-doc citations:

1. `refreshInDocCitations()`
2. compute `missing = currentAttachedCitationIds.filter(id => !citationCache.has(id))`
3. fetch missing ids via `/api/citations/by_ids`
4. derive `docCitations` by filtering `citationCache.values()`
5. full card rebuild for `#doc-citations-list`

Source: `app/static/js/editor.js:1102-1111`.

Backend attached-citation hydration also exists in `/api/docs` and `/api/docs/{id}` serialization via `_serialize_document_row()` (`app/routes/editor.py:159-175`), but the frontend does not use hydrated citation records from those endpoints; it uses only attached ids.

### Note hydration flow

Global notes:

1. `loadNotes()` builds query params from filters
2. `/api/notes`
3. assign payload to `allNotes`
4. `renderNotes()`
5. `renderResearchNotes()`

Source: `app/static/js/editor.js:1259-1290`.

Backend note hydration:

- `list_notes()` loads note rows, enriches sources and links, then adds tag ids (`app/routes/extension.py:773-824`).

Doc notes:

1. `loadDocNotes()` -> `/api/docs/{currentDocId}/notes`
2. backend `_list_doc_note_links()` first loads link rows, then loads note rows, then hydrates links with note payloads
3. frontend fully rebuilds `#doc-notes-list`

Source: `app/static/js/editor.js:515-557`, `app/routes/editor.py:674-716`, `1005-1012`.

### Outline, history, checkpoint population

- Outline is fully computed from `quill.getLines()` both on doc open and after debounced edits (`app/static/js/editor.js:820-848`).
- Checkpoint list is lazy per document open and refresh, but it also refreshes after checkpoint creation and restore (`app/static/js/editor.js:851-903`).

### Eager vs lazy vs mixed

- Eager on boot: header, docs, projects, notes, citation library
- Lazy per active doc: doc notes, doc citation hydrate, checkpoints
- Lazy by modal open: attach-note modal only fetches notes if `allNotes` is empty
- Mixed: notes power boot surfaces and modal surfaces; citations power boot library and doc-specific panels

### Redundant fetches and redundant transforms

Verified:

- `/api/docs` fetches full document bodies, followed by `/api/docs/{id}` for the chosen document.
- `loadNotes()` may run during boot and again immediately if restored left tab is `"notes"` because `setContentTab("notes")` calls `loadNotes()` (`app/static/js/editor.js:1822-1833`, `2036-2037`).
- `renderNotes()`, `renderResearchNotes()`, `renderAttachNoteList()`, and `renderQuickNoteLinkList()` all derive different filtered views from the same `allNotes` array without shared normalized selectors.
- Citation rendering can re-render style variants via `/api/citations/render` for insertions and bibliography even when citation records are already cached (`app/static/js/editor.js:966-999`, `1131-1162`).

## Rendering flow map

### DOM ownership mapping

| DOM region | Owner function(s) | Render strategy | Notes |
| --- | --- | --- | --- |
| `#docs-list` | `renderDocs()` | full rebuild | creates per-doc export/delete/open listeners |
| `#projects-list` | `renderProjects()` | full rebuild | creates per-project delete listeners |
| `#notes-list` | `renderNotes()` | full rebuild | largest stateful renderer, editing mode included |
| `#research-notes-list` | `renderResearchNotes()` | full rebuild | derived from `allNotes` |
| `#attach-note-list` | `renderAttachNoteList()` | full rebuild | derived from `allNotes` |
| `#quick-note-sources` | `renderQuickNoteSources()` | full rebuild | draft-only |
| `#quick-note-link-list` | `renderQuickNoteLinkList()` | full rebuild | derived from `allNotes` |
| `#citations-list` | `loadCitationLibrary()` via `buildCitationCard()` | full rebuild | cards + format select + action listeners |
| `#doc-citations-list` | `refreshInDocCitations()` via `buildCitationCard()` | full rebuild | separate card instances for same data |
| `#outline-list` | `buildAndRenderOutline()` | full rebuild | one button per heading |
| `#history-list` | `renderCheckpoints()` | full rebuild | one row per checkpoint |
| `#doc-notes-list` | `loadDocNotes()` | full rebuild | one item per attached note |
| editor content `.ql-editor` | Quill | internal diff/render | application code still triggers metric/outline side effects |
| export modal previews | export click handler | replace text/list content | modal body rebuilt on open and style change |

### Reusable rendering helpers already present

- `appendTextElement()` is reused in note renderers.
- `buildCitationCard()` is shared by citation library and in-doc citations.

These helpers reduce repeated element creation code, but they do not centralize ownership or diffing.

### Rendering duplication

Verified duplication:

- Citation cards are rendered separately for library and in-doc panels using the same record source.
- Notes render four different list forms from `allNotes`.
- Quick-note and attach-note workflows each have their own list renderer over the same note dataset.

### Expensive DOM mutation hotspots

The likely hotspots by volume are:

- `renderDocs()` for large doc counts, because each item includes up to five export buttons and optional delete button.
- `renderNotes()` for large note counts, because each note includes multiple rows, badges, source links, and action buttons.
- `loadCitationLibrary()` for large citation libraries, because every card creates a select and multiple buttons.
- `highlightActiveLine()` on every selection change, because it queries all active paragraph nodes before setting the current one (`app/static/js/editor.js:1893-1897`).

## Event system and interaction flow

### Listener registration pattern

Global registrations happen once during `startEditor()`:

- document pointer listeners for button click motion (`app/static/js/editor.js:181-202`)
- Quill `text-change` and `selection-change` (`app/static/js/editor.js:1900-1913`)
- global `window` listeners for `beforeunload`, `online`, `offline`, and modal click-dismiss (`app/static/js/editor.js:1915`, `1959-1962`, `1984-1990`, `2028`)
- static control listeners for search inputs, tabs, sidecar buttons, export modal, and note modals (`app/static/js/editor.js:1917-2027`)

Per-render listeners are added repeatedly in item renderers:

- document item buttons and row click
- project row delete
- citation card actions
- note item action delegation plus edit-mode input handlers
- doc-note insert/detach buttons
- checkpoint restore buttons
- attach-note item actions
- quick-note checkbox changes

### Centralized vs scattered

The system is mixed:

- top-level global listeners are centralized near the bottom of `editor.js`
- item listeners are scattered inside each render function
- action execution is partially centralized via `runAction()`, but only some flows use it

### Rebinding and listener duplication risk

Verified:

- Because containers are cleared before rebuild, old nodes and listeners are dropped with the subtree. This avoids classic double-binding on the same node.
- The cost is repeated listener creation and repeated closure allocation on every refresh.

### Cursor and focus preservation

Verified mechanisms:

- `selection-change` stores the latest range.
- insertion APIs call `getInsertionIndex()`.
- note edit mode uses `queueMicrotask()` to restore focus to inline editors (`app/static/js/editor.js:1529-1533`).
- attach-note modal and quick-note modal also use `queueMicrotask()` to focus inputs (`app/static/js/editor.js:1392-1393`, `1775-1777`).

Likely focus-loss causes:

- clicking sidebar or modal controls naturally moves focus out of Quill
- list rerenders remove and recreate buttons after actions
- `openDoc()` replaces all editor contents and resets outline/history/doc-note panels
- `getInsertionIndex()` may restore an outdated `lastKnownRange` after content or selection context changed

### Interaction cost classification

| Path | Classification | Trigger | Immediate cost | Scaling factor | Duplication attribution |
| --- | --- | --- | --- | --- | --- |
| typing | Interaction | each user edit | full text metrics, autosave scheduling, outline scheduling, checkpoint threshold update | grows with active doc length | side effects run per keystroke even when panels closed |
| doc switch | Interaction | doc click | autosave previous doc, fetch new doc, Quill reset, outline rebuild, doc-note/citation/checkpoint hydrate | grows with doc size and sidecar data | duplicates doc body already present in `allDocs` |
| note filter change | Interaction | notes filter input | debounced `/api/notes`, then notes + research rerender | grows with note count | same `allNotes` powers multiple views |
| citation search | Interaction | citation-search input | debounced `/api/citations`, full library rerender | grows with citation count | card rebuild duplicates existing cache data |
| attach citation | Interaction | citation card action | mutate ids, autosave stage, rerender in-doc citations | grows with attached citation count | later background sync sends whole doc payload |
| attach note | Interaction | modal attach action | POST link, refetch doc notes, optional insert into editor | grows with attached note count | attached note modal still depends on global notes cache |
| note inline edit enter/save | Interaction | note action button | full `loadNotes()` roundtrip after action | grows with note count | entire list is reloaded for single-note changes |

## Save/sync behavior map

### Autosave trigger conditions

- editor content change from Quill user input (`app/static/js/editor.js:1900-1907`)
- title input change (`app/static/js/editor.js:1914`)
- selection loss when dirty (`app/static/js/editor.js:1912`)
- doc switch calls `await autosaveDoc()` before loading next document (`app/static/js/editor.js:767`)
- `beforeunload` calls `autosaveDoc()` if dirty (`app/static/js/editor.js:1915`)

### Autosave and sync flow

1. `queueAutosave()` debounces 2s (`AUTOSAVE_DEBOUNCE_MS = 2000`)
2. `autosaveDoc()` reads full Quill contents and HTML, stages local dirty payload, updates save text, clears `isDirty`, updates doc list, schedules sync after 400ms
3. `syncDocNow()` checks online state, dirty state, retry delay, and in-flight dedupe
4. sends `PUT /api/docs/{id}` with full local payload
5. on success, clears local dirty state and rerenders doc list
6. on failure, writes retry metadata back to `localStorage`, marks sync failed, schedules retry

Source: `app/static/js/editor.js:563-657`.

### Checkpoint creation/restore

- checkpoint creation is opportunistic from `text-change`, gated by 4 minutes or 700 estimated changed characters (`app/static/js/editor.js:882-890`, `1900-1907`)
- checkpoint restore forces checkpoint creation first, then posts restore, then resets Quill content and refreshes checkpoints (`app/static/js/editor.js:892-903`)

### Background behavior classification

| Path | Classification | Trigger | Immediate cost | Scaling factor | Duplication attribution |
| --- | --- | --- | --- | --- | --- |
| `scheduleDocSync` / `syncDocNow` | Background | autosave, retry, manual sync, online event | full-doc PUT plus list rerender | grows with doc payload size and dirty-doc count | duplicates in-memory doc state and local persisted state |
| `syncAllDirtyDocs` interval | Background | every 8s | reads all local dirty docs, maybe multiple syncs | grows with dirty doc count | same docs may also be scheduled individually |
| checkpoint checks | Background-ish on interaction | every edit | timestamp/threshold check, possible POST+history reload | grows with edit frequency | history UI refreshed even if panel collapsed |
| outline debounce | Background-ish on interaction | every edit | rebuild after 700ms | grows with heading count and doc size | runs regardless of outline panel visibility |

### Potential race conditions and unnecessary write loops

Verified mitigations:

- `openDocRequestSeq`, `citationLoadRequestSeq`, `notesLoadRequestSeq`, and `docNotesLoadRequestSeq` ignore stale responses.
- `runAction()` prevents duplicate action execution for the same action key.
- `syncInFlightByDocId` dedupes concurrent syncs.

Verified risks:

- `autosaveDoc()` stages and syncs the full doc payload after citation attach/remove even though only `attached_citation_ids` changed.
- `updateDocInList()` always rerenders the whole doc list after local autosave and after sync success (`app/static/js/editor.js:746-750`, `581`, `621`).
- `beforeunload` calls async `autosaveDoc()` without a `sendBeacon`-style guarantee; reliability is best-effort only.

## Safe cache vs dangerous cache analysis

### Safe caches

These caches are relatively safe because they are either in-flight dedupe only or immutable-enough render memoization.

- `actionInFlight`
  Prevents duplicate execution of keyed actions; entries are removed in `finally` (`app/static/js/editor.js:429-452`).
- `inFlightRequestCache`
  Only dedupes concurrent requests and deletes the entry after completion (`app/static/js/editor.js:455-466`).
- `citationRenderCache`
  Keyed by `citation.id:style`, used to avoid repeated render endpoint calls for the same style (`app/static/js/editor.js:74`, `966-999`).

Why relatively safe:

- none persist across sessions
- none attempt to be authoritative application state
- stale data naturally expires when action/request completes or citation/style pair changes

### Dangerous caches

These caches are more hazardous because they behave like source-of-truth state without invalidation discipline.

- `allDocs`
  Stores boot-fetched serialized docs, including content bodies. It is partially updated by `updateDocInList()` and partially superseded by `/api/docs/{id}` responses.
- `allNotes`
  Feeds multiple views with different needs; freshness depends on explicit `loadNotes()` calls.
- `allProjects`
  Used for render lookups and project creation checks; can be stale between project mutation and next reload.
- `citationCache`
  Used as the main citation entity store across library, in-doc panel, and insertion actions, but there is no invalidation except explicit delete.
- local dirty doc entries in `localStorage`
  Necessary for resilience, but they overlay server state in `openDoc()` and can outlive surrounding in-memory assumptions.
- `lastKnownRange`
  Functionally a cursor cache; dangerous because it is reused after focus shifts, document changes, or rerenders.

Why dangerous:

- they influence live UI behavior
- they can outlast the context in which they were derived
- invalidation is manual and partial
- several are used as both cache and state store

## Bottlenecks and root causes

### Slow initial population

Verified hypotheses:

- sequential boot fetch chain delays first document open (`app/static/js/editor.js:2030-2045`)
- docs list overfetches full document bodies (`app/routes/editor.py:837-845`)
- citation library and notes load eagerly even before their panels are needed (`app/static/js/editor.js:2031-2035`)

### Stalling click actions

Verified hypotheses:

- many actions trigger full-list rerenders afterward:
  - docs: `updateDocInList()` -> `renderDocs()`
  - notes: `loadNotes()` -> `renderNotes()` + `renderResearchNotes()`
  - citations: `loadCitationLibrary()` or `refreshInDocCitations()`
- actions often perform network work directly in click handlers without a local optimistic update path

### Sluggish panel opening

Verified hypotheses:

- the notes panel is backed by a full notes dataset and full rerender
- citation panels rebuild complete card trees instead of toggling visibility on prebuilt nodes
- outline/history refreshes rebuild complete containers

### Delayed editor readiness

Verified hypotheses:

- editor shell renders immediately
- Quill is created early
- real readiness for writing into a hydrated document is delayed by boot fetch order, not by Quill initialization

### Cursor/focus instability

Verified hypotheses:

- focus moves into sidebars/modals/buttons during actions
- insertion relies on `lastKnownRange` restoration rather than preserving editor focus structurally
- `openDoc()` and restore paths replace content and reset editor-side derived state

### Excessive rerenders

Verified hypotheses:

- whole sections are rebuilt for nearly every update
- list renders are not incremental
- there is no DOM diffing layer outside Quill

### Duplicate loads or duplicate transforms

Verified hypotheses:

- `/api/docs` and `/api/docs/{id}` both provide document content
- `loadNotes()` can run twice during boot
- notes are transformed into multiple independent list shapes client-side from the same raw array
- citation render endpoint may be called again per style during insertion/bibliography

### Long synchronous operations in critical paths

Observed synchronous work with likely visible cost as data grows:

- `getTextMetrics()` calls `quill.getText()` and scans full document text on every user change (`app/static/js/editor.js:495-505`, `1900-1907`)
- `buildAndRenderOutline()` scans every line and rebuilds the outline (`app/static/js/editor.js:820-848`)
- `highlightActiveLine()` removes `.is-active-paragraph` from all matching nodes on every selection change (`app/static/js/editor.js:1893-1897`)
- `renderNotes()`, `renderDocs()`, and citation panel rebuilds allocate many elements and listeners synchronously

## Risky coupling / brittle areas

1. **`editor.js` is both shell controller and domain store.**
   Boot logic, state modeling, network calls, Quill wiring, list rendering, modal workflows, and sync behavior are all mixed.

2. **Notes are the most brittle subsystem.**
   One dataset powers left-nav notes, research notes, attach-note modal, quick-note linking, inline edit flows, and citation conversion.

3. **Document state is split across server payload, local overlay, editor contents, doc list summary, and sync metadata.**

4. **Citation handling is split across attached ids, cached citation entities, rendered-style cache, hidden cite tokens inside editor text, and DOM card selection.**

5. **The current DOM ownership model makes any shell redesign risky before isolation.**
   Large render functions own both presentation and action wiring.

## Recommended prerequisite refactors before UI redesign

1. **Split boot orchestration from feature modules.**
   Extract boot/loading coordinator, document session state, notes surfaces, citations surfaces, and sync manager from `editor.js`.

2. **Separate list-summary data from active-document hydration.**
   `/api/docs` should feed sidebar metadata, while `/api/docs/{id}` remains the document-content hydrate path.

3. **Create a normalized client store for docs, notes, projects, and citations.**
   Views should derive from shared entity maps plus selectors, not from repeated ad hoc filtering over `allNotes` and `citationCache.values()`.

4. **Give each DOM region a stable owner with patch-style updates.**
   Start with docs list, notes list, and citation panels.

5. **Move insertion/cursor restoration into an explicit editor session service.**
   `lastKnownRange` handling should not be spread across action handlers.

6. **Decouple background sync state from presentation state.**
   Keep one canonical dirty/sync model and adapt UI from it.

## Quick wins

- Defer `loadProjects()`, `loadNotes()`, and `loadCitationLibrary()` until their surfaces are first opened.
- Stop sending `content_delta` and `content_html` in `/api/docs` list responses.
- Avoid `renderDocs(allDocs)` after every autosave and sync unless list-visible fields changed.
- Skip outline rebuilds while outline panel is collapsed.
- Skip checkpoint history reload when history panel is collapsed.
- Replace `highlightActiveLine()` query-all removal with last-active-node tracking.

## Medium-complexity improvements

- Introduce per-surface render functions that patch existing nodes instead of full rebuilds.
- Normalize `allNotes`, `allProjects`, and `citationCache` into entity maps with selectors.
- Separate note attachment/search data loading from full note-management loading.
- Make note mutations patch local entity state first, then reconcile from server.
- Create a single document session object that owns current doc id, local overlay, attached citations, and editor-derived state.

## High-risk changes to avoid for now

- Replacing Quill as part of the performance pass.
- Changing backend note/citation/document semantics beyond payload shaping for overfetch reduction.
- Rewriting all panel UIs and state models in one step.
- Removing local-first dirty persistence before a replacement resilience path exists.
- Changing citation token semantics in document text before the current attachment/render coupling is isolated.
