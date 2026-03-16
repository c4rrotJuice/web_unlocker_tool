# Migration Pack Integration Notes

The rebuild uses `writior_migration_pack/` at the repo root as the canonical schema contract.

## Ordered execution contract

1. `001_extensions_and_utils.sql`
2. `002_accounts_and_billing.sql`
3. `003_growth_and_unlocks.sql`
4. `004_taxonomy.sql`
5. `005_sources_citations_quotes.sql`
6. `006_notes.sql`
7. `007_documents.sql`
8. `008_rpc_functions.sql`
9. `009_triggers_rls.sql`

## Required canonical tables

- `user_profiles`
- `user_preferences`
- `user_entitlements`
- `auth_handoff_codes`
- `unlock_events`
- `guest_unlock_usage`
- `bookmarks`
- `user_milestones`
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
- `documents`
- `document_checkpoints`
- `document_citations`
- `document_notes`
- `document_tags`

## Required canonical RPCs

- `replace_document_citations_atomic`
- `replace_document_tags_atomic`
- `replace_document_notes_atomic`
- `replace_note_tag_links_atomic`
- `replace_note_sources_atomic`
- `replace_note_links_atomic`

## Explicit exclusions

- No `user_meta` reads or writes.
- No compatibility tables.
- No schema-fallback logic.
- No `documents.citation_ids`.
- No route-local ownership validation duplication when canonical services can own it.
