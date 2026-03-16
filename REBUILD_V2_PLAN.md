# Writior v2 Rebuild Readiness

## Canonical contract

The repository is now being prepared as a fresh canonical rebuild.

Hard rules for implementation:

- The migration pack at repo root `writior_migration_pack/` is the source of truth.
- `auth.users` already exists in Supabase and is the only assumed pre-existing auth dependency.
- No backward-compatibility tables or serializers will be recreated.
- `user_meta` is not account truth.
- JS-readable auth cookie trust is not allowed.
- Schema-fallback behavior is not allowed.
- `documents.citation_ids` is not allowed.
- Route-local business logic sprawl is not allowed.

Canonical migration order:

1. `001_extensions_and_utils.sql`
2. `002_accounts_and_billing.sql`
3. `003_growth_and_unlocks.sql`
4. `004_taxonomy.sql`
5. `005_sources_citations_quotes.sql`
6. `006_notes.sql`
7. `007_documents.sql`
8. `008_rpc_functions.sql`
9. `009_triggers_rls.sql`

## Target module boundaries

### `app/core/*`

- `config.py`: environment and canonical migration-pack configuration.
- `db.py`: migration-pack contract loading, schema smoke verification, shared DB helpers.
- `auth.py`: strict bearer-token auth primitives only.
- `entitlements.py`: normalized capability derivation from `user_entitlements`.
- `errors.py`: shared domain-to-HTTP error mapping.
- `serialization.py`: shared canonical serializer helpers.

### `app/modules/identity/*`

- Owns `user_profiles`, `user_preferences`, `user_entitlements`, `auth_handoff_codes`.
- Rebuild account state and auth handoff on canonical tables only.

### `app/modules/billing/*`

- Owns `billing_customers`, `billing_subscriptions`.
- Syncs billing provider state into canonical entitlements.

### `app/modules/unlock/*`

- Owns `unlock_events`, `guest_unlock_usage`, `bookmarks`, `user_milestones`.
- Rebuilds unlock permits, guest usage tracking, bookmarks, and milestones.

### `app/modules/research/*`

- Owns taxonomy and research graph:
  - `projects`
  - `tags`
  - `sources`
  - `citation_instances`
  - `citation_renders`
  - `citation_templates`
  - `quotes`
  - `notes`
  - `note_sources`
  - `note_links`
  - `note_tag_links`

### `app/modules/workspace/*`

- Owns:
  - `documents`
  - `document_checkpoints`
  - `document_citations`
  - `document_notes`
  - `document_tags`
- Uses canonical atomic RPCs for relation replacement.

### `app/modules/extension/*`

- Extension-facing orchestration only.
- Delegates all business logic to canonical services in identity, unlock, research, and workspace.

### `app/modules/insights/*`

- Rebuilds dashboard/reporting reads from canonical tables and RPCs only.

## Migration-pack integration notes

- The legacy `sql/` directory is not canonical for the rebuild and should not drive implementation.
- Schema smoke verification must prove the canonical tables and RPCs are present in the migration pack before feature work proceeds.
- Atomic write paths must use:
  - `replace_document_citations_atomic`
  - `replace_document_tags_atomic`
  - `replace_document_notes_atomic`
  - `replace_note_tag_links_atomic`
  - `replace_note_sources_atomic`
  - `replace_note_links_atomic`

## Phase 1-safe implementation areas

- Identity/account read models and capability service.
- Billing-to-entitlement synchronization.
- Canonical research repositories and serializers.
- Canonical workspace document/checkpoint/relation services.
- Extension orchestration on top of shared services.
- Insights/reporting derived from canonical relations and RPCs.
