# Phase 1 — System Diagnosis & Failure Analysis

## Scope and method
This audit focused on the end-to-end request lifecycle for:
- note creation
- note → citation conversion
- document creation
- editor save/autosave
- Supabase-backed persistence
- extension local-first + sync paths

Reviewed surfaces:
- `app/static/js/editor.js`
- `app/routes/editor.py`
- `app/routes/extension.py`
- `app/routes/citations.py`
- `app/services/supabase_rest.py`
- `app/routes/http.py`
- `app/services/resilience.py`
- `extension/background.js`
- `extension/sidepanel.js`

---

## Primary root causes of intermittent failures

### 1) Unhandled async UI failures break interaction flows (editor + extension)
A large number of async click handlers issue network requests without guarded `try/catch/finally` and without per-action recovery paths. When a request rejects (timeout/network/JSON parse failure), execution short-circuits and UI state is left ambiguous (e.g., stale modal state, no recovery messaging, no consistent re-enable behavior).

**Impact:** perceived “random failures”, “buttons stop working”, and frozen-feeling UI after one failed operation.

### 2) No client-side request cancellation/timeout on editor fetches
The browser-side editor request path uses `fetch` via `authFetch` with no timeout, no abort controller, and no deadline budget. Slow network responses can stall critical paths (`openDoc`, `loadNotes`, exports, checkpoint operations), while UI remains in intermediate states.

**Impact:** network sensitivity and request pileups under slow or lossy conditions.

### 3) Partial race mitigation exists, but not across all dependent request chains
There is sequence guarding for some flows (`openDocRequestSeq`, `notesLoadRequestSeq`, autosave sequencing), but dependent follow-up calls (`loadDocNotes`, `refreshInDocCitations`, `loadCheckpoints`) are still executed as a long chain and can fail mid-flight without isolated fallback.

**Impact:** document switch can partially apply state; stale/partial side panels; user sees inconsistent “loaded” vs actual data readiness.

### 4) Note→citation conversion has strict input assumptions and brittle error propagation
`/api/notes/{note_id}/citation` enforces UUID note IDs and depends on citation creation constraints. UUID coercion or citation validation errors surface as 4xx/5xx but the UI collapses all non-OK responses into a generic toast.

**Impact:** intermittent “unprocessable entity”-style failures with limited diagnosability and no guided recovery for users.

### 5) Sync architecture is split-brain between local-first extension state and server-first editor state
The extension is local-first with queued sync; the editor is server-first and synchronous for most operations. There is no shared sync contract/state model exposed consistently across both surfaces.

**Impact:** freshness mismatches and unpredictable cross-surface behavior (note appears in one place but not the other yet, with weak sync visibility).

---

## Secondary contributing issues

### A) Inconsistent loading-state discipline
Some operations set explicit status (e.g., autosave text), many others do not. Buttons are rarely disabled during in-flight operations, and operation-level idempotency guards are inconsistent.

### B) Generic backend error mapping masks actionable causes
Many upstream Supabase failures are converted to generic `500` messages; client toasts often further compress all failures to one generic message. This prevents targeted retries and accurate UX feedback.

### C) Retry strategy is backend-only and not operation-aware
Server-side HTTP client has retries for transient statuses/timeouts, but UI-side fetches do not. Also, not all backend operations are safe/effective for blind retry without idempotency semantics.

### D) Validation asymmetry between client payload shaping and backend constraints
There are strict UUID and schema constraints in note/citation routes, while some clients allow free-form local edits and only fail at sync time.

### E) Queue flushing is best-effort but not backpressure-aware
Extension sync queue flushes sequentially and requeues failures, but lacks richer retry metadata (attempt count, next retry time, error class). This can cause repeated rapid failures under persistent outages.

---

## Fragile architectural areas

1. **Editor request lifecycle orchestration**
   - Strongly coupled sequential async chains per view transition.
   - Missing standardized operation wrapper (timeout, cancellation, status transitions, retry hints).

2. **Cross-surface synchronization model**
   - Extension and editor use different consistency models.
   - No unified “sync state machine” for notes/citations/documents.

3. **Error taxonomy + UI mapping**
   - Backend sometimes returns structured error codes, but frontend handling is largely generic.
   - Users cannot distinguish validation issues, auth expiry, transient network, or dependency degradation.

4. **Operation idempotency and deduplication boundaries**
   - Autosave coalescing is better than other operations.
   - Note/citation/document action buttons can issue repeated requests under rapid clicks or retries without unified dedupe keys.

5. **Observability gaps at user-flow level**
   - There is request-level logging and metrics, but no cohesive flow-level tracing for “create note → convert citation → attach to doc”.

---

## Diagnosis summary
The platform’s instability is primarily caused by **incomplete async lifecycle control at UI boundaries** and **inconsistent state/sync models across editor vs extension**. Backend resilience primitives exist, but they are not matched by equivalent client-side lifecycle guarantees. As a result, slow networks, validation edge-cases, and partial failures present as random or frozen behavior rather than recoverable states.

This concludes **Phase 1 diagnosis**. No Phase 2+ implementation changes are included in this deliverable.
