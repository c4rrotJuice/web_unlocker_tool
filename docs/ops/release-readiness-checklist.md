# Release Readiness Checklist

This is the authoritative pre-deploy checklist for Writior v2.

## Runtime shape

- [ ] `app/main.py` mounts only canonical routers.
- [ ] No compatibility alias endpoints are mounted.
- [ ] No active runtime code references dropped schema fields or tables.
- [ ] No JS-readable cookie bridge is accepted for protected API auth.
- [ ] Extension handoff uses only `/api/auth/handoff` and `/api/auth/handoff/exchange`.

## Security and billing

- [ ] `CORS_ORIGINS` is explicit and matches the deployed web origins.
- [ ] Security headers are enabled in the target environment.
- [ ] Rate limits are enabled for auth-sensitive and write-sensitive routes.
- [ ] `PADDLE_WEBHOOK_SECRET` is set in production.
- [ ] Billing webhook verification rejects invalid signatures.
- [ ] Billing webhook processing is idempotent and replay-safe.
- [ ] Redirect validation rejects external or malformed redirect targets.
- [ ] Log output has been checked for token, handoff-code, and secret redaction.

## Schema and ownership

- [ ] Latest canonical SQL migrations have been applied successfully.
- [ ] RLS remains enabled on canonical research, workspace, billing, and webhook tables.
- [ ] Real write paths enforce ownership filters.
- [ ] Canonical relation replacement RPCs are present and callable.
- [ ] Cross-user write and read denial tests pass.

## Verification matrix

- [ ] signup/login/bootstrap
- [ ] entitlement derivation by tier/status
- [ ] auth handoff one-time flow
- [ ] source/citation/quote/note/document lifecycle
- [ ] atomic relation replacement
- [ ] editor hydration and autosave
- [ ] bibliography generation
- [ ] extension capture flows
- [ ] work-in-editor seeded flow
- [ ] bookmarks/activity/insights/reporting
- [ ] billing webhook mutation safety
- [ ] cross-user access denial
- [ ] CORS/security headers/rate limiting
- [ ] no legacy endpoints or tables referenced by active code

## Release blockers

Do not deploy if any of these are true:

- active code references dropped schema fields or tables
- non-contract endpoints are still mounted
- cookie-only auth reaches protected routes
- billing webhook mutates without verification
- unsafe redirect inputs are accepted
- ownership denial fails for canonical entities
- legacy unlock-web runtime surfaces remain active
- release docs contradict runtime behavior
