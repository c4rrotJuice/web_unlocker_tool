# Research Project Container Plan

## 1) Current schema assessment (`public.note_projects`)

### Strengths
- Clear per-user ownership model (`user_id` FK to `auth.users`) with cascade delete.
- Name quality guardrails (`trim(name)` length check + case-insensitive uniqueness per user).
- Useful list index already exists for most recent activity (`user_id, updated_at desc`).
- Existing RLS model is simple and understandable (`auth.uid() = user_id`) and aligns with Supabase best practices.

### Structural limitations for a full research workspace
- **Naming scope is too narrow**: `note_projects` implies a notes-only container, but the container is intended to hold notes, citations, drafts, sources, and highlights.
- **Limited metadata**: no description, lifecycle status, icon, or “last opened” timestamp for UX and workflow state.
- **No ownership-safe composite key target**: future child tables often need `(project_id, user_id)` FKs to enforce same-owner integrity in DB constraints.
- **No archive semantics**: currently cannot cleanly differentiate active vs archived projects.
- **No direct support for project dashboards**: no metadata for recency/opened state; aggregates should be derived, but recency primitives are missing.

## 2) Recommended role for projects

### Decision: **B (evolve into a generalized projects container), phased safely**
- Keep the existing physical table for backward compatibility now.
- Expand it into the primary research root now (metadata + indexes + constraints).
- Optionally rename to `projects` in a later compatibility migration once application references are updated.

This keeps the model simple: **one root container per workspace concept**, no extra abstraction layer needed yet.

## 3) Metadata decisions

Included now (high-value, low-risk):
- `description text` — lightweight context for long-running research projects.
- `status text default 'active' check in ('active','archived')` — archive lifecycle.
- `icon text` — emoji/icon cue for dense project lists.
- `last_opened_at timestamptz` — useful for recents sorting.
- `archived_at timestamptz` — explicit archive timestamp.

Not added now:
- `visibility` (single-user model + RLS makes this premature).
- `note_count` / `citation_count` counters (better as derived query/materialized view initially to avoid write amplification and drift).

## 4) Relationship model guidance

For future tables (`citations`, `editor_documents`, `captured_sources`, etc.):
- Include both `project_id` and `user_id` on each child row.
- Enforce FK ownership integrity via composite FK to project key `(project_id, user_id) -> note_projects(id, user_id)`.
- Keep user ownership checks centralized and avoid duplicated project metadata in child tables.

This pattern prevents cross-user linking mistakes at the database layer, not just in application code.

## 5) Query/index strategy

Expected common queries and support:
- **Project list by user**: `(user_id, updated_at desc)` (existing).
- **By lifecycle bucket**: `(user_id, status, updated_at desc)`.
- **Recently opened**: `(user_id, last_opened_at desc nulls last)`.
- **Archive browsing**: partial `(user_id, archived_at desc) where archived_at is not null`.

Avoid adding speculative indexes for low-confidence access patterns.

## 6) Supabase RLS compatibility

Current project policy style remains valid and simple.

Recommended pattern for future child tables:
- `using ((select auth.uid()) = user_id)` and `with check ((select auth.uid()) = user_id)`.
- Composite FK `(project_id, user_id)` ensures row cannot point at another user’s project even if app logic regresses.

This gives defense-in-depth: **RLS + FK ownership constraints**.

## 7) Naming and maintainability

`note_projects` is now semantically outdated.

### Safe rename strategy (later phase)
1. Create `public.projects` table (or rename existing) once app references are ready.
2. Move constraints/index names to `projects_*` convention.
3. Keep compatibility layer during rollout (temporary view or dual-write path).
4. Migrate API/routes to new name.
5. Drop compatibility layer after verification.

Given existing runtime references to `note_projects`, immediate rename is not recommended in this migration.

## 8) Migration approach used

Implemented as additive SQL migration:
- Added metadata columns.
- Added status/icon constraints.
- Added composite unique index `(id, user_id)` for future composite FKs.
- Added operational indexes for status/opened/archive queries.
- Added trigger function to synchronize `status` and `archived_at`.

No destructive operations, preserves all existing records.
