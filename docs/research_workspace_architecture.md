# Research Workspace Architecture (Notes + Editor + Citations)

## Existing Architecture Summary

Writior already had the core primitives needed for a research workspace:

- **Documents** in `public.documents`, with `citation_ids` attached and edited in Quill.  
- **Citations** in `public.citations`, queried by editor and extension.  
- **Notes** (`public.notes`) with `note_projects`, `note_tags`, and local-first extension sync.  
- **Supabase RLS** keyed by `user_id` for user data isolation.

The editor UI already had left-rail notes/projects, a right-rail citation library, and APIs for notes CRUD.

## Design Decisions

This implementation keeps the existing patterns and extends them additively:

1. **Keep existing notes schema and APIs.**
2. **Use normalized tags/projects (already present).**
3. **Add optional note→citation link (`citation_id`)** so notes can participate in citation workflows without duplicating citation records.
4. **Add note source metadata** (`source_title`, `source_author`, `source_published_at`) to support scholarly attribution.
5. **Add PostgreSQL full-text search** on notes via `search_vector` + GIN index.
6. **Add archive/restore endpoints** based on existing `archived_at` soft-delete support.
7. **Editor integration:** add insert/convert/archive actions directly in note cards and a dedicated right-side "Research Notes" panel.
8. **Extension capture enrichment:** populate source metadata from page metadata when saving notes.

## Data Flow

### Capture from Web

1. User highlights page text in extension.  
2. Content script opens note modal and sends note payload with text + URL + derived page metadata (`title`, `author`, `datePublished`).  
3. Background stores locally and queues sync.  
4. Server `/api/notes` persists and normalizes domain / timestamps.

### Research While Writing

1. Editor loads notes from `/api/notes` (with filters/search).  
2. User can insert note text into Quill directly.  
3. User can convert a note into citation via `/api/notes/{id}/citation`.  
4. Server creates citation record (reusing existing citation engine) and links `notes.citation_id`.

### Archival

- `/api/notes/{id}/archive` sets `archived_at`.
- `/api/notes/{id}/restore` clears `archived_at`.
- `/api/notes` defaults to active notes, but supports archived/include_archived query flags.

## Security

RLS on notes now also validates ownership of linked entities:

- Insert/update checks require linked `project_id` to belong to same `user_id`.
- Insert/update checks require linked `citation_id` to belong to same `user_id`.

This prevents cross-tenant linking through guessed IDs.

## Performance

Added indexes supporting heavy note collections:

- `(user_id, project_id, created_at desc)`
- `(user_id, source_domain, created_at desc)`
- `(user_id, archived_at)`
- `(user_id, citation_id)` partial
- `GIN(search_vector)`

These support scoped list queries + note search at scale.
