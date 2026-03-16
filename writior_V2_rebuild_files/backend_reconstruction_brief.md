# Lyra / Writior v2 Backend Reconstruction Brief

## Role

You are a senior backend/product engineer rebuilding the Writior backend into **Lyra v2**, a production-grade research-to-writing platform.

This is **not** a table-by-table migration task.

Assume:
- the old database has been dropped,
- legacy compatibility tables are gone,
- legacy route fallbacks are gone,
- schema-missing compatibility behavior must not be reintroduced,
- the rebuild is a **fresh canonical implementation** using the new Lyra data model.

Your job is to implement the backend around the **new canonical model**, not to preserve old technical debt.

---

## Product framing

Lyra is a focused research-to-writing system.

Core mental model:
- **Sources** = knowledge origins
- **Citation instances** = user-owned citation records grounded in canonical sources
- **Quotes** = evidence truth
- **Notes** = synthesis truth
- **Documents** = composition truth

The system includes:
- authentication and account entitlements,
- unlock history / bookmarks / reports,
- canonical research graph,
- writing workspace,
- extension-connected capture and sync.

Do not treat Lyra as a generic PKM app. It is a research workflow product with citations and captured evidence as first-class system primitives.

---

## Critical implementation stance

### 1. This is a fresh rebuild
Do **not** attempt to preserve old route shapes just because they existed before.

### 2. Do not reintroduce legacy structures
Do **not** recreate or emulate any of the following:
- legacy `citations` table
- `documents.citation_ids`
- `citation_instances.document_id`
- `citation_instances.legacy_citation_id`
- legacy note-tag/project compatibility tables
- schema-fallback behavior for missing tables
- compatibility serializers that pretend old models still exist

### 3. Canonical relations only
All many-to-many relationships must be modeled through canonical relation tables and canonical services.

### 4. Thin routes, real services
Routes should become thin orchestration layers. Business logic must live in service modules. Persistence logic must live in repository modules.

### 5. Atomic write paths
Replace-all relation writes must use the canonical atomic RPC functions from the new schema rather than ad hoc delete/insert REST sequences.

---

## Canonical database model to build around

Assume the following schema is now the source of truth:

### Account / identity
- `user_profiles`
- `user_preferences`
- `user_entitlements`
- `billing_customers`
- `billing_subscriptions`
- `auth_handoff_codes`

### Growth / unlock / usage
- `unlock_events`
- `guest_unlock_usage`
- `bookmarks`
- `user_milestones`

### Taxonomy
- `projects`
- `tags`

### Canonical research graph
- `sources`
- `citation_instances`
- `citation_renders`
- `citation_templates`
- `quotes`
- `notes`
- `note_sources`
- `note_links`
- `note_tag_links`

### Workspace
- `documents`
- `document_checkpoints`
- `document_citations`
- `document_notes`
- `document_tags`

The SQL blueprint already exists and should be treated as authoritative.

---

## Architectural target

Refactor the backend into bounded modules with clear ownership.

### Required structure

Use or move toward a structure like this:

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
      routes.py
      service.py
      repo.py
      schemas.py

    billing/
      routes.py
      service.py
      repo.py
      schemas.py

    unlock/
      routes.py
      service.py
      repo.py
      schemas.py

    research/
      sources/
      citations/
      quotes/
      notes/
      taxonomy/

    workspace/
      routes.py
      service.py
      repo.py
      schemas.py

    extension/
      routes.py
      service.py
      repo.py
      schemas.py

    insights/
      routes.py
      service.py
      repo.py
      schemas.py
```

Exact filenames may vary, but the separation of concerns must hold.

---

## Core implementation goals

Implement the new backend so that:

1. the API surface is backed by the new canonical schema only,
2. relation ownership is consistently validated,
3. document/note/citation linking is atomic and predictable,
4. extension and web clients consume the same canonical contracts,
5. serialization is centralized,
6. entitlements are derived from `user_entitlements`, not scattered heuristics,
7. reports are computed from canonical tables,
8. the system is ready for production cleanup, not transitional patching.

---

## Required domain behaviors

# 1. Identity and account domain

Implement canonical account read/write flows around:
- `user_profiles`
- `user_preferences`
- `user_entitlements`
- `auth_handoff_codes`

### Required behaviors
- create/read/update profile
- read/update preferences
- read current entitlement/capability state
- create and consume auth handoff codes for extension/web handoff

### Important rules
- capability truth comes from `user_entitlements`
- do not rely on old `user_meta` patterns
- if the app needs a richer capability object, derive it in service code from tier/status rather than persisting duplicate flags everywhere

### Deliverable
Create a canonical account capability service that returns a normalized capability payload such as:

```json
{
  "tier": "free",
  "status": "active",
  "documents": {"limit": 3},
  "unlocks": {"limit": 10, "window": "week"},
  "exports": ["pdf", "html"],
  "citation_styles": ["apa", "mla"]
}
```

The exact limits may follow current product rules, but the shape must be canonical and shared across web and extension flows.

---

# 2. Unlock domain

Implement unlock/history/bookmark/report support around:
- `unlock_events`
- `guest_unlock_usage`
- `bookmarks`
- `user_milestones`

### Required behaviors
- record unlock activity
- record extension-originated research capture events if applicable
- list unlock history for a user
- bookmark add/remove/list
- support report queries using canonical reporting helpers

### Important rules
- do not use old `unlock_history` or `ip_usage` assumptions in runtime code
- guest throttling / anonymous usage should use the new guest usage model
- history and reports must operate on canonical tables only

---

# 3. Taxonomy domain

Implement project and tag services around:
- `projects`
- `tags`

### Required behaviors
- create/list/update/archive projects
- create/list/update/delete tags
- ownership validation on every write path
- reuse taxonomy services from note/document flows

### Important rules
- no duplicated tag validation in multiple route files
- no compatibility logic for old note-tag entities

---

# 4. Sources / citations domain

Implement canonical citation behavior around:
- `sources`
- `citation_instances`
- `citation_renders`
- `citation_templates`

### Source model rules
- `sources` are canonical/shared source records
- `citation_instances` are user-owned working citation records
- a citation instance points to one canonical source
- rendered citation outputs come from `citation_renders`

### Required behaviors
- resolve or create canonical source records
- create user citation instances from canonical sources
- read/list citation instances
- render citation styles and cache results in `citation_renders`
- list citation records in a normalized shape for all consumers
- support custom citation templates if the current plan/tier allows it

### Important rules
- do not recreate a legacy flat citation model
- do not attach documents directly on citation instance rows
- document linkage belongs only in `document_citations`
- serializers for citation responses must be centralized and reused everywhere

### Required canonical response shape
At minimum, design a normalized citation read shape that includes:
- citation instance id
- source id
- canonical source fields needed by the UI
- available render data
- quote count
- note count if cheap to compute or included by hydration path
- created/updated timestamps

Do not let each route invent a slightly different citation payload.

---

# 5. Quotes domain

Implement quote behavior around:
- `quotes`

### Required behaviors
- create quote under a citation instance
- list quotes by citation
- list quotes by document through canonical relation traversal when needed
- read quote detail with embedded normalized citation payload
- update/delete quote with ownership checks

### Important rules
- quote ownership must align with citation ownership
- quote hydration must use the shared citation read path, not bespoke serializers
- quote-to-note workflows should remain possible using canonical note creation inputs

---

# 6. Notes domain

Implement synthesis behavior around:
- `notes`
- `note_sources`
- `note_links`
- `note_tag_links`

### Required behaviors
- create/read/update/archive/delete notes
- create notes directly
- create notes from extension capture
- create notes from quote context
- attach/rewrite note sources atomically using `replace_note_sources_atomic`
- attach/rewrite note links atomically using `replace_note_links_atomic`
- attach/rewrite note tag links atomically using `replace_note_tag_links_atomic`
- list notes with project/tag/source context
- full text search over notes via canonical search vector

### Important rules
- notes are not documents
- note sources must come from canonical `note_sources`, not inline JSON blobs except during transport before persistence
- use the new atomic RPCs for relation replacement
- any quote-linked note should preserve `quote_id` and `citation_id` where appropriate

### Canonical note serializer
Create one canonical note serializer and reuse it everywhere. It should expose at minimum:
- id
- title
- note_body
- highlight_text
- project_id
- citation_id
- quote_id
- tags
- linked_note_ids
- sources
- status
- created_at / updated_at

---

# 7. Workspace / documents domain

Implement writing workspace behavior around:
- `documents`
- `document_checkpoints`
- `document_citations`
- `document_notes`
- `document_tags`

### Required behaviors
- create/read/update/archive/delete documents
- list documents with canonical attached relation ids and hydrated summaries where appropriate
- checkpoint create/list/restore
- replace attached citations atomically using `replace_document_citations_atomic`
- replace attached notes atomically using `replace_document_notes_atomic`
- replace attached tags atomically using `replace_document_tags_atomic`
- support editor hydration via canonical document reads

### Important rules
- do not store inline citation arrays on documents
- document relation truth must come from relation tables only
- document serializers must be centralized
- editor-facing read endpoints should not perform scattered ad hoc hydration in multiple files

### Canonical document serializer
Create one canonical document serializer that includes at minimum:
- id
- title
- content_delta
- content_html
- project_id
- status
- archived
- attached_citation_ids
- attached_note_ids
- tag_ids
- hydrated tags
- created_at / updated_at
- can_edit / allowed_export_formats if these are derived capability fields

That serializer should be reused for create, read, update, restore, and list endpoints.

---

# 8. Extension domain

The extension UI/UX is being preserved, but the backend contracts must be cleaned up.

### Required behaviors
Implement extension-facing endpoints/services for:
- auth handoff
- citation capture
- note capture
- quote capture if applicable
- recent project/tag resolution for capture UX
- sync-safe canonical writes

### Important rules
- extension routes must not duplicate business logic from note/citation/document services
- extension-specific code should orchestrate existing canonical services
- no extension-only shadow data model
- extension note creation must persist into the same note graph as web-created notes

### Special requirement
Focus on note-making and citation capture flows so that extension-originated captures are first-class canonical entities, not special-case records.

---

# 9. Insights / reports domain

Implement reporting against canonical data only.

### Required behaviors
- unlock activity summaries
- domain frequency summaries
- citation style breakdowns
- milestone reads

### Important rules
- no dependence on dropped legacy citation tables
- use SQL helpers where they are already appropriate
- keep report service separate from unlock service if that keeps responsibilities clearer

---

## API contract reconstruction rules

### 1. Centralize serializers
There must be one canonical serializer per major entity family:
- document serializer
- note serializer
- citation serializer
- quote serializer
- project serializer
- tag serializer

### 2. Centralize ownership checks
Ownership and relation validation must live in shared service/repo helpers, not repeated inline in many routes.

### 3. No schema-fallback behavior
Do not implement any code paths that silently degrade because a table or relation is missing.

### 4. No legacy compatibility keys unless explicitly required by active frontend code
If an old key only exists for backward compatibility with dropped code, remove it.

### 5. Prefer explicit canonical relation hydration
Hydrate attached citations/notes/tags through canonical helper paths rather than mixing raw joins in many endpoints.

---

## Concrete implementation tasks

Implement the backend in this order.

### Phase 1 — Core infrastructure alignment
1. Introduce/clean up module boundaries.
2. Add shared DB access/repository helpers.
3. Add shared auth helpers.
4. Add shared entitlement capability builder.
5. Add shared serialization layer.
6. Remove any schema-fallback code.

### Phase 2 — Taxonomy and account domains
1. Implement projects repo/service/routes.
2. Implement tags repo/service/routes.
3. Implement profiles/preferences/entitlements/handoff routes and services.

### Phase 3 — Canonical citation system
1. Implement source resolution/creation flow.
2. Implement citation instance CRUD/listing.
3. Implement citation rendering cache flow.
4. Implement canonical citation serializer.
5. Replace any old citation logic with the new canonical path.

### Phase 4 — Notes and quotes
1. Implement quote CRUD/hydration using shared citation paths.
2. Implement notes CRUD.
3. Implement atomic note relation replacement.
4. Implement note search.
5. Implement quote-to-note creation support through canonical note service.

### Phase 5 — Workspace
1. Implement document CRUD/list.
2. Implement document serializer.
3. Implement checkpoints.
4. Implement atomic document relation replacement.
5. Implement editor hydration endpoints backed by canonical document services.

### Phase 6 — Extension support
1. Reconnect extension auth handoff.
2. Rebuild extension note/citation capture endpoints using canonical services.
3. Ensure extension flows do not bypass ownership or canonical serializers.

### Phase 7 — Unlock and insights
1. Implement unlock event recording and history reads.
2. Implement bookmarks.
3. Implement report endpoints.
4. Implement milestone reads.

### Phase 8 — Cleanup and hardening
1. Remove dead compatibility code.
2. Remove old serializers.
3. Remove old repos/services tied to dropped schema.
4. Consolidate tests around canonical behavior.

---

## Testing requirements

You must add or update tests so the new system proves the canonical model is actually being used.

### Minimum required test coverage

#### Account / entitlements
- profile bootstrap/read/update
- preference update/read
- entitlement capability object generation
- auth handoff issue/consume behavior

#### Projects / tags
- owned project/tag creation
- cross-user access denied
- duplicate normalized names rejected

#### Citations / sources
- canonical source dedupe works
- citation instance creation grounds to source
- citation render caching works
- citation list/read shape is normalized and reused

#### Quotes
- quote create/list/update/delete
- quote hydration uses shared citation serializer/path
- document-grounded quote listing works through canonical relations if supported

#### Notes
- note create/read/update/archive/delete
- note tag replacement is atomic
- note source replacement is atomic
- note link replacement is atomic
- note search returns expected results
- quote-to-note creation preserves linkages

#### Documents
- document create/read/update/archive/delete
- document serializer is consistent across list/get/create/update/restore
- document citation replacement is atomic
- document note replacement is atomic
- document tag replacement is atomic
- checkpoint restore returns canonical document shape

#### Extension-facing flows
- auth handoff works
- extension note capture creates canonical note rows
- extension citation capture creates canonical citation rows
- extension capture routes reuse core services rather than shadow writes

#### Unlock / reports
- unlock event recording works
- bookmark CRUD works
- report helpers return canonical results

---

## Acceptance criteria

The implementation is only complete if all of the following are true:

1. no runtime path depends on dropped legacy tables or columns,
2. no route invents its own serializer for documents/notes/citations,
3. document/note relation writes use atomic canonical RPCs,
4. extension flows persist the same canonical entities as web flows,
5. entitlements are derived from `user_entitlements`,
6. reports read canonical tables only,
7. tests prove shared hydration paths are actually reused,
8. the codebase is simpler after the rebuild, not just differently tangled.

---

## Things you must not do

- Do not add compatibility columns “just in case.”
- Do not recreate legacy tables under new names.
- Do not keep mixed old/new citation systems alive together.
- Do not leave duplicated serializers in multiple route files.
- Do not perform relation replacement with manual non-atomic delete/insert sequences when canonical RPCs exist.
- Do not add frontend-oriented hacks into persistence models unless they are clearly justified.
- Do not silently swallow ownership inconsistencies.
- Do not treat extension-created entities as second-class or special-format records.

---

## Final deliverable expected from the agent

Produce a complete backend reconstruction that:
- uses the Lyra v2 schema as the only source of truth,
- exposes clean canonical APIs for web and extension clients,
- removes transitional data-model baggage,
- preserves product capabilities,
- and leaves the codebase ready for the next phase: editor/workflow UX consolidation on top of a trustworthy backend.

When done, provide:
1. a concise implementation summary,
2. files added/changed,
3. notable contract changes,
4. tests added/updated,
5. any remaining explicitly scoped follow-up work.
