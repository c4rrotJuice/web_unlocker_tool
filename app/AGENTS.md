# Backend AGENTS.md

## Backend Ownership Rules
- Route modules stay thin.
- Business logic belongs in module services.
- Persistence belongs in repositories or canonical data-access helpers.
- Serialization must be centralized and reused.
- Do not patch behavior in unrelated legacy routes when a canonical module owns the domain.

## Canonical Backend Boundaries
- Identity/account: canonical account state, preferences, entitlements, handoff.
- Billing: provider mapping, subscription/customer state, webhook mutation.
- Research: sources, citations, quotes, notes, taxonomy.
- Workspace: documents, checkpoints, relation hydration, editor-facing contracts.
- Extension: transport/orchestration only; no domain ownership duplication.
- Insights/activity: unlock events, bookmarks, reporting, milestones.

## API and Contract Rules
- Preserve the strict v2 API contract as the public backend surface.
- Protected endpoints require bearer auth unless the contract explicitly marks them public.
- Keep boot and hydrate payloads compact.
- Avoid response inflation and internal-only fields.
- Use one canonical serializer per entity family.
- Replace-all relation writes must be atomic where the contract requires them.

## Security Rules
- Preserve safe redirect validation.
- Preserve bearer verification and auth/session boundary discipline.
- Preserve webhook verification requirements.
- Preserve header, CORS, and rate-limit expectations.
- Preserve log redaction and avoid sensitive payload leaks.

## Data Rules
- Use canonical schema only.
- No `user_meta` account truth.
- No `documents.citation_ids`.
- No schema-fallback behavior for missing canonical tables.
- No temporary persistence shortcuts around canonical services/RPCs.

## Legacy Route Rules
- Required public/auth entry surfaces such as `/`, `/auth`, `/pricing`, and `/auth/handoff` may remain, but must map cleanly to canonical logic.
- Do not leave stale landing-page references to removed backend endpoints.
- If a compatibility alias exists, keep it explicit and thin.

## Validation Rules
- Prefer targeted backend tests for the changed domain plus cross-surface regression tests where contracts are user-visible.
- A status-code-only test is not sufficient where shape, ownership, side effects, or security matter.
