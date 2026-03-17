# Auth Module AGENTS.md

## Module Purpose
This module owns authenticated identity resolution, canonical account/session state access, secure auth handoff, redirect validation, and route-protection helpers.

## This Module Owns
- bearer token extraction and verification
- current-user resolution
- canonical account/capability loading
- `/api/auth/*` canonical helpers
- `/auth/handoff` issue/exchange support
- redirect-path validation
- route classification helpers for public vs auth-required surfaces

## This Module Must Not Own
- billing mutations
- research/domain business logic
- workspace document logic
- extension local policy
- stale cookie bridge compatibility logic

## Implementation Rules
- Supabase Auth is the identity root.
- Canonical account truth comes from canonical account tables, not `user_meta`.
- Capability truth must derive centrally from entitlements.
- Protected APIs require verified bearer tokens.
- Reject cookie-only auth trust.
- Redirect destinations must be safe internal app-relative paths only.
- Rate-limit handoff issue/exchange and other sensitive auth endpoints.
- Never log tokens, handoff codes, or raw session payloads.

## Legacy Handling
- Do not restore `wu_access_token`-style trust.
- Do not preserve frontend-only redirect “protection” as real security.
- Preserve required `/auth` and `/auth/handoff` surfaces, but map them to canonical logic only.

## Validation Expectations
- missing/invalid/expired bearer token rejection
- valid token acceptance
- centralized capability derivation tests
- redirect validation negative-path coverage
- handoff one-time use, TTL, and reuse rejection
- logging redaction tests
- allowed-origin/CORS tests for auth-sensitive routes

## Escalation Triggers
Stop if:
- canonical origin strategy is unclear
- redirect behavior conflicts with required public routes
- auth handoff would expose external redirect risk
- capability truth is being duplicated outside shared auth/entitlement paths
