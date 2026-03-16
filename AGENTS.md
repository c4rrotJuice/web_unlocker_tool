# AGENTS.md — Writior v2 Rebuild

## Mission
Rebuild Writior into a production-grade **extension-first research-to-writing platform** on the **fresh canonical v2 schema**.

This is a reconstruction, not a legacy migration.

The old database is assumed dropped.
The migration pack is authoritative.
Legacy compatibility behavior must not be reintroduced.

Core user journey:
**Capture → Understand → Synthesize → Write**

Canonical object pipeline:
**Sources → Citations → Quotes → Notes → Documents**

---

## Non-negotiable product stance

- Writior is **not** a generic PKM app.
- The **browser extension is a first-class product surface**, not a side utility.
- The **editor is a research-aware writing workspace**, not just a rich text page.
- The **backend is the single source of truth** for entitlements, authorization, ownership, canonical entities, and relation integrity.
- The **v2 migration pack** is the database source of truth.
- The **strict v2 API contract** is the contract source of truth unless an implementation task explicitly amends it.>


No backward compatibility layer. Fresh rebuild only. 
new database


No legacy user_meta. Canonical account truth comes from the new account tables. 
new Security & Authentication I…


No JS-readable auth cookie trust. Verified bearer auth only. 
new Security & Authentication I…


No legacy citations table behavior. Use canonical sources/citation instances/renders. 
writior backend reconstruction


No inline document citation truth. Use relation tables and atomic RPCs. 
Quill Editor Reconstruction Imp…


No route-local entitlement sprawl. Use one capability builder. 
new Security & Authentication I…


No monolithic editor or extension runtime. Both need modular decomposition. 
Quill Editor Reconstruction Imp…

 
new Extension Architecture & Fi…


Extension is first-class, but not the source of truth. Backend wins. 
new Extension Architecture & Fi…


Reports and insights must use canonical tables only. 
writior backend reconstruction



---

## Absolute rules

### 1) No legacy carryover
Do **not** recreate, preserve, or emulate any of the following unless a task explicitly says otherwise:

- `user_meta`
- legacy `citations` table behavior
- `documents.citation_ids`
- `citation_instances.document_id`
- `citation_instances.legacy_citation_id`
- schema-fallback behavior for missing tables/columns
- route-local compatibility serializers
- JS-readable auth cookie trust
- weak `wu_access_token` bridge behavior
- ad hoc legacy unlock web flow as a primary product path

### 2) Canonical schema only
Build against the fresh v2 schema from the migration pack:

- account: `user_profiles`, `user_preferences`, `user_entitlements`, `billing_*`, `auth_handoff_codes`
- activity: `unlock_events`, `guest_unlock_usage`, `bookmarks`, `user_milestones`
- taxonomy: `projects`, `tags`
- research: `sources`, `citation_instances`, `citation_renders`, `citation_templates`, `quotes`, `notes`, `note_sources`, `note_links`, `note_tag_links`
- workspace: `documents`, `document_checkpoints`, `document_citations`, `document_notes`, `document_tags`

### 3) Thin routes, real services, real repos
Route handlers must stay thin.

- business logic lives in services
- persistence logic lives in repositories
- serializers are centralized
- ownership checks are centralized
- relation replacement must use canonical atomic RPCs

### 4) Security model is mandatory
Use the v2 security stance everywhere:

- Supabase Auth is the only identity root
- protected API requests use `Authorization: Bearer <token>`
- backend verifies bearer tokens
- capability truth comes from `user_entitlements`
- no JS-readable access-token cookie trust
- extension↔web auth handoff uses hardened one-time `auth_handoff_codes`
- authenticated web origin is `https://app.writior.com`
- `web-unlocker-tool.onrender.com` is not the long-term session authority

### 5) Extension-first architecture
Preserve and improve:

- persistent sidepanel
- popup launcher
- on-page selection capture
- icon entry point to toggle panel visibility
- local-first capture for UX resilience
- secure extension→web handoff
- seeded “Work in Editor” flow

But do **not** let extension-local caches become entitlement or policy truth.

---

## Architectural target

Preferred backend/module structure:

```text
app/
  core/
    config.py
    db.py
    auth.py
    entitlements.py
    errors.py
    serialization.py

  modules/
    identity/
    billing/
    unlock/
    research/
      sources/
      citations/
      quotes/
      notes/
      taxonomy/
    workspace/
    extension/
    insights/
```

Preferred editor runtime direction:

```text
app/static/js/editor_v2/
  core/
  document/
  research/
  actions/
  ui/
  api/
```

Preferred extension direction:

```text
extension/
  background/
  content/
  sidepanel/
  popup/
  shared/
  storage/
  auth/
  styles/
```

Exact filenames may vary, but the separation of concerns must hold.

---

## Domain rules

### Identity / account
- bootstrap canonical account rows through the SQL-defined bootstrap path
- read profile/preferences/entitlements canonically
- derive a shared capability payload from `user_entitlements`
- never use route-local heuristic entitlement logic as the main policy engine

### Unlock / activity
- use `unlock_events`, `guest_unlock_usage`, `bookmarks`, `user_milestones`
- do not use old `unlock_history` / `ip_usage` runtime assumptions
- reports and activity views must read canonical tables only

### Sources / citations
- `sources` are canonical shared source records
- `citation_instances` are user-owned records grounded in a source
- rendered outputs belong in `citation_renders`
- document linkage belongs in `document_citations`, not on citation rows
- citation payloads must use one canonical serializer

### Quotes
- quotes belong under citation instances
- quote hydration must reuse shared citation read paths
- quote→note workflows must preserve lineage

### Notes
- notes are synthesis, not documents
- sources/links/tags use canonical relation tables and atomic replacement paths
- one canonical note serializer everywhere

### Documents / workspace
- document text lives in `documents`
- checkpoints live in `document_checkpoints`
- attached citations live in `document_citations`
- attached notes live in `document_notes`
- attached tags live in `document_tags`
- bibliography generation uses attached citation relations as source of truth
- replace-all relation writes must use the canonical RPCs

### Extension
- content script owns capture UI only
- background owns network/auth/queue authority
- extension routes orchestrate shared canonical services only
- no extension-only shadow entity model

---

## UI / UX rules

### Global
- keep the app lightweight
- avoid heavy SPA frameworks unless a task explicitly justifies them
- prefer modular vanilla JS / server-rendered HTML patterns
- the UI must feel calm, fast, and research-oriented

### Editor
Use the three-panel model:
**Research Explorer | Writing Surface | Context Rail**

Required behavior:
- Quill remains the writing engine
- layered hydration, not fetch-everything boot
- autosave states must be visible
- checkpoints/restore remain first-class
- inline citation and note affordances remain subtle
- command-driven insert / attach / link / convert flows
- extension-seeded entry must feel first-class

### Extension
- injected UI must be isolated from host page CSS/layout
- keep overlays small and safe
- no broad host DOM rewrites
- popup stays lightweight
- sidepanel is the main persistent extension workspace

### Feedback
Use a unified toast + persistent status system for:
- success/error/info/warning toasts
- save/sync/offline/error status indicators
- calm, non-intrusive confirmations

---

## Performance rules

### Must do
- prefer staged/lazy hydration
- keep first writable time fast
- avoid full document refetch after every save
- debounce/coalesce save flows
- keep payloads compact
- avoid giant monolithic runtime files
- avoid unnecessary rail rerenders
- keep extension popup/panel boot light

### Must not do
- no fetch-all-on-boot behavior
- no giant global SPA state manager
- no entitlement computation in UI as source of truth
- no direct content-script API sprawl
- no route fan-out for every small UI interaction
- no heavy modal maze when a context rail / inline flow works better

---

## Testing & validation rules

Every substantial implementation must include tests or verification steps appropriate to the layer.

### Backend
Add or update tests for:
- auth verification
- entitlement/capability derivation
- ownership enforcement
- cross-user access denial
- atomic relation replacement
- handoff issue/exchange
- webhook idempotency where relevant
- report/activity correctness on canonical tables

### Frontend/editor
Verify:
- first paint and first writable behavior
- autosave state transitions
- checkpoint creation/restore
- layered hydration behavior
- research insert/attach/link/convert flows
- seeded extension entry flow

### Extension
Verify:
- content script isolation
- background-only network authority
- local-first queue behavior
- sync reconciliation
- stale capability snapshot cannot override backend truth
- secure handoff into web editor

### Security
Verify:
- protected routes reject missing/invalid bearer tokens
- no legacy cookie-auth trust paths remain
- safe redirect validation
- security headers/CORS/rate limiting where applicable
- no token/handoff-code leakage in logs

---

## Implementation workflow for Codex

For non-trivial work, follow this order unless the task explicitly says otherwise:

1. inspect relevant files and current runtime shape
2. identify legacy coupling to remove
3. align the target change with the migration pack + strict API contract
4. implement through shared modules, not route-local hacks
5. run focused tests first
6. run broader regression checks second
7. summarize exactly what changed, what remains, and any follow-up risk

If a task is large, prefer **incremental vertical slices** that leave the repo in a working state after each step.

---

## Editing rules

- prefer small, reviewable patches
- preserve unrelated code unless cleanup is part of the task
- do not do broad renames without strong reason
- do not introduce dead compatibility code “just in case”
- remove obsolete code paths once the replacement is proven
- keep naming explicit and domain-oriented

When changing contracts:
- update serializer/repo/service usage consistently
- update tests in the same change
- update docs/contracts if the public surface changed

---

## What success looks like

A change is successful only if it moves Writior toward this end state:

- extension-first, but backend-authoritative
- canonical schema only
- centralized auth/entitlements/serialization
- secure bearer-token API model
- hardened extension↔web handoff
- modular editor/runtime architecture
- predictable research graph behavior
- fast, calm, research-aware UX
- production-grade code that removes transitional legacy drift

Do not optimize for visual parity with the legacy app.
Optimize for a cleaner v2 architecture that preserves the real product strengths.
