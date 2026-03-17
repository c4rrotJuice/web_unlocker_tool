# AGENTS.md

## Project Operating Rules
This repository is under an active Writior v2 rebuild and hardening program. The goal is to preserve required product capability while converging fully onto the canonical v2 architecture.

## Product Reality
Writior is a multi-surface research-to-writing product, not just an editor. Required product surfaces include:
- authenticated web app shell
- dashboard and insights
- research graph
- editor workspace
- browser extension
- extension-to-web handoff
- billing/entitlements
- required public routes such as `/`, `/auth`, and `/pricing`

Do not simplify the product into “just the editor” or “just the extension”.

## Global Priorities
1. Preserve canonical v2 architecture.
2. Prevent legacy drift.
3. Preserve required user-facing capability that is still part of the product.
4. Prefer precise, minimal changes over broad rewrites unless explicitly requested.
5. Validate changes before declaring completion.

## Canonical Architecture Rules
- Canonical module-owned implementations are the source of truth.
- Thin routes, real services, repository/data-access boundaries.
- Keep canonical account truth in `user_profiles`, `user_preferences`, `user_entitlements`, billing tables, and `auth_handoff_codes`.
- Keep canonical research truth in `sources`, `citation_instances`, `citation_renders`, `quotes`, `notes`, `note_sources`, `note_links`, `note_tag_links`.
- Keep canonical workspace truth in `documents`, `document_checkpoints`, `document_citations`, `document_notes`, `document_tags`.
- Replace-all relation writes must use canonical atomic RPCs.
- Shared serializers/contracts must be reused across routes and surfaces.
- The strict v2 API contract is the public backend contract unless an approved compatibility exception is explicitly stated.

## Legacy Drift Rules
- Do not revive deprecated legacy implementations because they are easier to patch.
- Do not reconnect dropped schema patterns or poisoned legacy tables.
- Do not reintroduce `user_meta` as account truth.
- Do not restore weak JS-readable auth cookie trust.
- Do not restore `documents.citation_ids`, inline relation truth, schema-fallback behavior, or legacy compatibility serializers.
- Do not restore monolithic frontend runtimes such as giant `editor.js` orchestration.
- If a legacy route must remain supported, keep it as a thin alias onto canonical ownership.

## Required Compatibility Surfaces
Preserve these routes/surfaces unless explicitly retired by architecture decision:
- `/`
- `/auth`
- `/pricing`
- `/auth/handoff`
- authenticated app-shell routes such as `/dashboard`, `/research`, `/projects`, `/editor`, `/insights`
- extension seeded “Work in Editor” handoff flow

## Auth and Security Rules
- Protected APIs require verified bearer-token auth.
- Capability truth must derive centrally from canonical entitlements.
- Do not trust client-writable cookies as identity.
- No wildcard production CORS.
- No open redirects.
- No secret, token, handoff code, or raw session payload logging.
- Billing webhook verification is mandatory on real mutation paths.

## Frontend Rules
- The shared v2 shell is authoritative.
- Server-rendered boot payloads must stay minimal.
- Fetch entity data through canonical APIs.
- Do not couple runtime behavior to stale HTML blobs or legacy endpoints.
- Preserve calm, lightweight, modular runtime design.

## Extension Rules
- The extension is a first-class client, not policy authority.
- Background is the network/auth/sync authority.
- Local-first persistence is for resilience and UX, not entitlement truth.
- Preserve secure handoff and canonical backend orchestration.
- Host-page safety and CSS isolation are mandatory.

## Scan Discipline
- Inspect only directly relevant files first.
- Avoid whole-repo scans unless the task explicitly requires cross-cutting analysis.
- Prefer file inventories, route inventories, ownership maps, and contract diffs over prose-heavy essays.
- Do not repeatedly rediscover architecture already documented here or in nested `AGENTS.md` files.

## Required Reporting Format
For scans and audits, output the structured `Codex Handoff` format.
For implementations, output the structured `Codex Implementation Report` format.
Keep outputs compact, decision-oriented, and file-aware.

## Validation Discipline
Do not declare success without validation. Always report:
- files changed
- tests run
- pass/fail results
- skipped validations and why
- known follow-ups or residual risks

## Escalation Rules
Stop and mark `needs_architecture_decision` if:
- ownership is ambiguous
- preserving a required legacy route conflicts with canonical ownership
- security, auth, billing, redirect, or handoff behavior is uncertain
- the safe migration path is unclear

Stop and mark `blocked_by_missing_context` if:
- required files, configs, contracts, migrations, or route inventory are missing
- the task depends on behavior not discoverable from the repo

## Success Standard
A task is complete only when:
- canonical ownership is preserved
- required behavior is implemented
- legacy drift is avoided
- validation passes or failures are explicitly explained
- remaining risks are clearly reported
