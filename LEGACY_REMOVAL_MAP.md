# Legacy Removal Map

## Delete

- `app/main.py` legacy runtime graph: depended on `user_meta`, cookie-auth fallback, and route-sprawl orchestration.
- `app/services/authentication.py`: writes `user_meta` and issues weak JS-readable `wu_access_token`.
- `app/routes/payments.py`: syncs billing state through `user_meta` instead of canonical billing + entitlements tables.
- `app/routes/dashboard.py`: reads and mutates `user_meta` counters and plan state.
- `sql/documents.sql`: preserves legacy `documents.citation_ids`.
- Legacy SQL migrations in `sql/`: additive historical patches are not the rebuild contract.
- Tests that encode forbidden behavior:
  - `tests/test_editor_schema_fallbacks.py`
  - tests asserting `user_meta`
  - tests asserting cookie-auth fallback
  - tests asserting schema-missing degraded fallbacks

## Replace

### Auth and identity

- `app/routes/auth_handoff.py`
  - Preserve one-time handoff code concept.
  - Rebuild to use canonical `auth_handoff_codes.session_payload`.
  - Remove raw token column assumptions from old migrations and route logic.

### Workspace

- `app/routes/editor.py`
  - Preserve document, checkpoint, export, and relation workflows conceptually.
  - Remove route-local business logic and schema fallback branches.
  - Rebuild on `documents`, `document_checkpoints`, `document_citations`, `document_notes`, `document_tags`.

### Extension

- `app/routes/extension.py`
  - Preserve note/project/tag/document orchestration concepts.
  - Rebuild on canonical module services.
  - Remove `user_meta` reads and direct route-owned persistence logic.

### Shared research persistence

- `app/services/research_entities.py`
  - Reuse UUID normalization and atomic-RPC orchestration ideas.
  - Remove compatibility behavior for missing schema and transitional fallbacks.

## Preserve Conceptually

### Editor and workspace UX to rebuild cleanly

- `app/static/js/editor.js`
- `app/static/js/editor_runtime/*`
- `app/templates/editor.html`

Preserve conceptually:

- document editing flow
- note and citation side panels
- checkpoint and export workflows

Do not preserve:

- legacy serializer shapes tied to `citation_ids`
- boot-order assumptions that depend on route-local aggregation

### Extension UX to rebuild cleanly

- `extension/background.js`
- `extension/content/unlock_content.js`
- `extension/popup.js`
- `extension/sidepanel.js`

Preserve conceptually:

- unlock capture flow
- metadata extraction
- note/citation capture UX
- auth handoff intent

Do not preserve:

- local assumptions about `account_type` truth from legacy payloads
- any dependence on weak cookie trust or legacy session mirroring

### Docs and reconstruction briefs

- `docs/*.md`
- `writior_V2_rebuild_files/*`

Use as implementation inspiration only. They are not the canonical contract; the migration pack is.
