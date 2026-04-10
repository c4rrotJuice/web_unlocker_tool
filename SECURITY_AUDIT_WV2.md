# Writior v2 Security Audit

## 1. Executive Summary
- overall risk rating: High
- count of confirmed vulnerabilities: 5
- count of likely vulnerabilities: 2
- count of compliant / verified-safe categories: 10
- top 5 urgent risks
  1. Authenticated shell pages (`/dashboard`, `/projects`, `/research`, `/editor`, `/insights`) are publicly renderable and rely on client-side auth redirects only.
  2. Web auth bootstraps `supabase-js` with default browser persistence, so bearer and refresh tokens land in `localStorage`.
  3. Extension bearer/refresh tokens are persisted in `chrome.storage.local`, which violates background-only session authority and broadens token exposure to other extension surfaces.
  4. Extension logout only clears local state and does not revoke the underlying Supabase session/refresh token.
  5. `/api/auth/signup` has no repo-side throttling/lockout, and handoff throttling is only per-process in-memory.

## 2. Audit Coverage
- directories reviewed
  - `app/`
  - `extension/`
  - `tests/`
  - repo manifests/configs at root (`package.json`, `package-lock.json`, `app/requirements.txt`, `extension/manifest.json`)
- route families reviewed
  - shell/public routes
  - identity/account routes
  - billing + webhook routes
  - unlock/activity routes
  - research routes
  - workspace/editor routes
  - extension + auth handoff routes
  - insights/reporting routes
- auth/session flows reviewed
  - web `/auth` sign-in + browser session bootstrap
  - app-shell token fetch flow
  - extension background session bootstrap/refresh/logout
  - extension popup + sidepanel auth messaging
  - extension auth-attempt + handoff exchange flow
  - `/auth/handoff` landing page flow
- deployment/config surfaces reviewed
  - app settings, CORS, HSTS, origins, secrets/env requirements
  - extension manifest host permissions and content script scope
- dependency manifests reviewed
  - `package.json` / `package-lock.json`
  - `app/requirements.txt`
  - `npm audit --omit=dev` output

## 3. Findings by Risk Class

### 1. Hardcoded API keys/secrets in frontend or extension UI/runtime
- Status: Compliant
- Severity: None
- Evidence:
  - `app/main.py:47-56`
  - `app/routes/shell.py:50-61`
  - `extension/shared/constants/endpoints.ts:1-17`
- Why it matters
  - Public clients inevitably receive the Supabase anon key and client-side Paddle token, but those are not service-role or webhook secrets.
- Realistic exploit path
  - No committed frontend/runtime service-role key, webhook secret, or private API credential was found in the reviewed tree.
- Recommended fix direction
  - Keep exposing only intended public client tokens; continue forbidding service-role secrets in browser code.
- Priority: P3

### 2. Missing rate limiting / lockout on login and auth-adjacent endpoints
- Status: Confirmed
- Severity: High
- Evidence:
  - `app/modules/identity/routes.py:37-39`
  - `app/templates/auth.html:459-497`
  - `app/modules/extension/service.py:245-359, 529-546`
  - `app/core/security.py:111-151`
- Why it matters
  - `/api/auth/signup` is a public account-creation/bootstrap path with no route dependency or service-side throttle, so automated signup abuse can burn backend resources and confirmation-email quota. The extension handoff endpoints do call a limiter, but it is only in-memory per process, so horizontal scaling or worker restarts weaken the protection materially.
- Realistic exploit path
  - A bot can repeatedly POST `/api/auth/signup`; in parallel, distributed requests to `/api/auth/handoff/*` can evade per-process counters by spreading across replicas.
- Recommended fix direction
  - Add explicit auth-sensitive throttling/lockout at the route layer for signup and move rate limiting to shared infrastructure for handoff/auth-sensitive flows.
- Priority: P1

### 3. SQL/query injection risks from string concatenation or unsafe query construction
- Status: Compliant
- Severity: None
- Evidence:
  - `app/services/supabase_rest.py:12-104`
  - `app/modules/research/citations/repo.py:54-120`
  - `app/modules/workspace/repo.py:49-223`
- Why it matters
  - Dynamic access patterns should still avoid raw SQL construction; the reviewed runtime code uses structured REST params and RPC payloads rather than interpolated SQL.
- Realistic exploit path
  - No runtime string-built SQL execution path was found in app or extension code; only test scaffolding uses raw SQL.
- Recommended fix direction
  - Continue using parameterized REST/RPC calls and normalized UUID validators.
- Priority: P3

### 4. Wildcard or over-broad CORS
- Status: Compliant
- Severity: None
- Evidence:
  - `app/core/config.py:80-86, 118-148`
  - `app/core/security.py:153-165`
- Why it matters
  - Over-broad CORS would expose bearer-auth APIs cross-origin.
- Realistic exploit path
  - In `staging`/`prod`, startup rejects `CORS_ORIGINS=*`, and middleware uses the configured origin list only.
- Recommended fix direction
  - Keep environment validation strict and avoid widening the origin list without review.
- Priority: P3

### 5. JWT/session tokens stored in unsafe browser locations or trusted through weak client-readable cookies
- Status: Confirmed
- Severity: High
- Evidence:
  - Web: `app/static/js/auth.js:82-92`, `app/templates/auth.html:466-480`
  - Extension: `extension/background/auth/session_store.ts:13-53`
  - Project rule reference: `AGENTS.md` auth/security and extension rules
- Why it matters
  - `window.supabase.createClient(config.url, config.key)` is instantiated with default browser persistence, which stores the session in `localStorage`; any XSS in the web app can steal bearer/refresh tokens. Separately, the extension persists the normalized session in `chrome.storage.local`, so session authority is no longer confined to the background worker.
- Realistic exploit path
  - Web XSS or compromised browser context can read the web session from localStorage; any privileged extension surface that can reach `chrome.storage.local` can read or overwrite extension tokens.
- Recommended fix direction
  - Replace default web persistence with a safer session model and move extension token custody to a background-only mechanism rather than shared extension storage.
- Priority: P0

### 6. Weak/default JWT or app secrets
- Status: Compliant
- Severity: None
- Evidence:
  - `app/core/config.py:87-109, 118-148`
  - `app/config/environment.py:10-52`
- Why it matters
  - Weak defaults on signing secrets or webhook secrets would undercut all auth guarantees.
- Realistic exploit path
  - The reviewed code does not define fallback JWT secrets or weak app-secret defaults; required billing secrets are enforced in prod.
- Recommended fix direction
  - Keep using Supabase as the identity root and continue failing fast on missing server secrets.
- Priority: P3

### 7. Admin/protected routes guarded only in frontend/client logic
- Status: Confirmed
- Severity: Critical
- Evidence:
  - `app/routes/shell.py:75-157`
  - `app/static/js/app_shell/boot.js:9-38`
  - `tests/test_phase7_frontend_shell.py:84-97`
- Why it matters
  - Required authenticated surfaces are served to unauthenticated users with status 200 and rely on browser-side token checks/redirects after render. That violates the stated requirement that protected pages be enforced server-side, and it leaves sensitive app-shell structure, seeded editor state, and route reachability publicly accessible.
- Realistic exploit path
  - An unauthenticated client can request `/dashboard`, `/projects`, `/research`, `/editor`, or `/insights` directly and receive the full shell HTML; only later does client JS discover there is no token and redirect.
- Recommended fix direction
  - Gate authenticated shell pages on verified bearer-backed server auth (or a server-established session) before rendering, while keeping public routes (`/`, `/auth`, `/pricing`) public.
- Priority: P0

### 8. Committed `.env` / secrets leakage / secret exposure in git history or sample files
- Status: Compliant
- Severity: None
- Evidence:
  - Repo search over `*.env*` returned no committed env files.
  - Reviewed manifests: `package.json`, `app/requirements.txt`, `extension/manifest.json`
- Why it matters
  - Committed env files or sample secrets are a common first compromise path.
- Realistic exploit path
  - No checked-in `.env` or obvious sample secret values were found in the current tree.
- Recommended fix direction
  - Keep env files out of version control and continue reviewing sample configs before commits.
- Priority: P3

### 9. Stack traces / DB internals / sensitive error leakage in responses
- Status: Compliant
- Severity: Low
- Evidence:
  - `app/core/errors.py:82-177`
  - `app/logging_utils.py:14-155`
- Why it matters
  - Verbose exceptions often leak implementation detail or tokens.
- Realistic exploit path
  - Extension API errors are normalized and redacted; app logging redacts sensitive keys/patterns. I did not find an endpoint intentionally returning stack traces or raw tokens.
- Recommended fix direction
  - Preserve centralized error handling and keep redaction coverage broad.
- Priority: P3

### 10. Unsafe file upload handling / MIME validation gaps
- Status: N/A
- Severity: None
- Evidence:
  - No reviewed route accepted uploaded files or used `UploadFile`/multipart handlers for user file ingest.
- Why it matters
  - Upload handlers are a common malware and parser attack surface.
- Realistic exploit path
  - No upload path was present in the current repo surface.
- Recommended fix direction
  - Reassess if file import/upload capability is introduced later.
- Priority: P3

### 11. Weak password hashing / unsafe auth credential handling
- Status: Compliant
- Severity: Low
- Evidence:
  - `app/templates/auth.html:466-480`
  - `app/modules/identity/service.py:50-78`
- Why it matters
  - Password handling must not devolve into app-managed weak hashing.
- Realistic exploit path
  - The repo delegates password verification/storage to Supabase Auth instead of implementing local password hashing.
- Recommended fix direction
  - Keep password verification inside Supabase Auth and avoid introducing app-side credential storage.
- Priority: P3

### 12. Non-expiring tokens / weak refresh rotation / stale long-lived session risk
- Status: Likely
- Severity: Moderate
- Evidence:
  - `extension/background/auth/session_store.ts:18-42`
  - `extension/background/auth/session_manager.ts:60-121`
  - `app/modules/extension/service.py:489-546`
- Why it matters
  - The extension keeps refresh tokens at rest until explicit logout and can refresh them through `/api/auth/handoff/refresh`; the repo does not enforce an additional inactivity TTL or device binding beyond Supabase defaults.
- Realistic exploit path
  - A stolen persisted refresh token remains useful until Supabase invalidates it or the user signs out everywhere.
- Recommended fix direction
  - Shorten token at-rest lifetime, reduce refresh-token exposure, and add explicit server-side revocation on logout.
- Priority: P2

### 13. Missing auth middleware/dependencies on internal/protected routes
- Status: Confirmed
- Severity: High
- Evidence:
  - Protected APIs generally use `Depends(require_request_auth_context)` (for example `app/modules/workspace/routes.py:101-293`, `app/modules/research/routes.py:144-617`).
  - Authenticated shell routes do not (`app/routes/shell.py:75-157`).
- Why it matters
  - The API layer is mostly bearer-gated, but the authenticated HTML surfaces themselves are still directly reachable without a backend auth dependency.
- Realistic exploit path
  - A user can hit the internal app-shell routes directly without presenting any bearer token and receive rendered app HTML.
- Recommended fix direction
  - Add server-side protection to authenticated shell/page routes to match the stricter API contract.
- Priority: P1

### 14. Server or container running with excessive privileges
- Status: N/A
- Severity: None
- Evidence:
  - No Dockerfile, compose file, Kubernetes manifest, or process manager config was present in the reviewed repo tree.
- Why it matters
  - Excessive runtime privileges can turn app compromise into host compromise.
- Realistic exploit path
  - This repo does not currently include deploy/runtime privilege configuration to assess.
- Recommended fix direction
  - Review runtime user/capabilities when infra manifests are added.
- Priority: P3

### 15. Database or admin ports/services exposed unsafely
- Status: N/A
- Severity: None
- Evidence:
  - No deploy manifest or port exposure config was present in the reviewed tree.
- Why it matters
  - Publicly exposed data stores/admin consoles are catastrophic when present.
- Realistic exploit path
  - No repository-managed port exposure surface was available to audit here.
- Recommended fix direction
  - Reassess when infrastructure-as-code is checked in.
- Priority: P3

### 16. IDOR / broken object ownership checks
- Status: Compliant
- Severity: Low
- Evidence:
  - `app/modules/common/ownership.py:25-66`
  - `app/modules/common/relation_validation.py:92-143`
  - `app/modules/workspace/service.py:212-523`
  - `tests/test_phase4_workflow_services.py:763-1204`
- Why it matters
  - Cross-user document/note/citation access would be a major multi-tenant break.
- Realistic exploit path
  - The reviewed services preload owned rows by `user_id`, relation replacement validates owned relation IDs before RPCs, and tests cover several unowned-reference rejection paths.
- Recommended fix direction
  - Keep ownership checks centralized and continue covering relation-RPC paths in tests.
- Priority: P3

### 17. Missing HTTPS enforcement / weak secure-origin assumptions
- Status: Compliant
- Severity: Low
- Evidence:
  - `app/core/security.py:166-196`
  - `app/core/config.py:142-148`
  - `extension/manifest.json:24-29`
- Why it matters
  - Mixed-origin assumptions or missing HSTS make bearer tokens easier to intercept.
- Realistic exploit path
  - The app enables HSTS by default, the canonical app origin defaults to HTTPS, and the extension host permission for the first-party app is HTTPS-only.
- Recommended fix direction
  - Preserve HSTS and avoid broadening first-party origin assumptions beyond HTTPS.
- Priority: P3

### 18. Logout that does not actually invalidate server-side session semantics
- Status: Confirmed
- Severity: High
- Evidence:
  - `extension/background/handlers/auth_handler.ts:97-101`
  - `extension/background/auth/session_manager.ts:34-38`
  - No extension-side Supabase `signOut`/revoke path found in repo search; web-only signout exists in `app/static/js/app_shell/boot.js:20-27`.
- Why it matters
  - Extension logout removes local state only; it does not revoke the Supabase refresh token or sign the session out server-side. A stolen refresh token therefore remains valid after “logout”.
- Realistic exploit path
  - An attacker who already captured the extension refresh token can continue using `/api/auth/handoff/refresh` even after the user presses Sign Out in the extension UI.
- Recommended fix direction
  - Wire extension logout to Supabase signout/revocation and verify the old refresh token can no longer mint sessions afterward.
- Priority: P1

### 19. Unreviewed vulnerable dependencies / package risk
- Status: Compliant
- Severity: Low
- Evidence:
  - `package.json`, `package-lock.json`, `app/requirements.txt`
  - `npm audit --json --omit=dev` returned zero vulnerabilities
- Why it matters
  - Known vulnerable deps often provide turnkey exploit chains.
- Realistic exploit path
  - No critical/high JS advisories were reported from the shipped dependency set; Python pins appear current, though no offline Python advisory database was available in-repo.
- Recommended fix direction
  - Add a Python advisory scan (for example `pip-audit`) in CI when tooling is available.
- Priority: P2

### 20. Open redirect / unsafe callback / unsafe `next`/redirect parameters
- Status: Compliant
- Severity: None
- Evidence:
  - `app/core/security.py:57-77`
  - `app/routes/shell.py:45-61`
  - `app/modules/extension/service.py:216-240`
  - `tests/test_security_helpers.py:67-79`
- Why it matters
  - Redirect bugs are especially dangerous around auth and handoff flows.
- Realistic exploit path
  - The reviewed code only accepts internal redirect paths, blocks nested redirect parameters, and rejects scheme/encoded payload tricks.
- Recommended fix direction
  - Reuse the same validators for any new callback or handoff flows.
- Priority: P3

## 4. Route Protection Matrix

| route/path | intended access level | actual enforcement found | auth dependency/middleware used | issue if any |
|---|---|---|---|---|
| `/` | public | public | none | none |
| `/auth` | public | public | none | none |
| `/pricing` | public | public redirect | none | none |
| `/pricing/success` | public | public redirect | none | none |
| `/dashboard` | auth-required | public HTML render | none | frontend-only auth guard |
| `/projects` | auth-required | public HTML render | none | frontend-only auth guard |
| `/projects/{project_id}` | auth-required | public HTML render | none | frontend-only auth guard |
| `/research` | auth-required | public HTML render | none | frontend-only auth guard |
| `/editor` | auth-required | public HTML render | none | frontend-only auth guard |
| `/insights` | auth-required | public HTML render | none | frontend-only auth guard |
| `/auth/handoff` | compatibility/public | public landing page | none | acceptable compatibility seam, but should stay minimal |
| `/api/public-config` | public | public | none | exposes public client config only |
| `/api/auth/signup` | public/auth-adjacent | public | none | no throttle/lockout |
| `/api/me`, `/api/profile`, `/api/preferences`, `/api/entitlements/current` | auth-required | bearer enforced | `require_request_auth_context` | none |
| `/api/billing/customer`, `/api/billing/subscription`, `/api/billing/checkout` | auth-required | bearer enforced | `require_request_auth_context` | none |
| `/api/webhooks/paddle` | public webhook | signature verified in handler | Paddle signature validation | none |
| `/api/activity/*` | auth-required | bearer enforced | `_activity_access` -> `require_request_auth_context` | none |
| `/api/projects*` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/tags*` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/sources*` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/citations*` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/quotes*` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/notes*` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/docs*`, `/api/editor/access` | auth-required | bearer enforced | `_access` -> `require_request_auth_context` | none |
| `/api/insights/*`, `/api/reports/monthly` | auth-required | bearer enforced | `_insight_access` -> `require_request_auth_context` | none |
| `/api/extension/bootstrap`, `/api/extension/taxonomy/recent`, `/api/extension/captures/*`, `/api/extension/work-in-editor`, `/api/extension/usage-events` | auth-required | bearer enforced | `_extension_access` -> `require_request_auth_context` | none |
| `/api/auth/handoff` | auth-required | bearer enforced | `_extension_access` -> `require_request_auth_context` | none |
| `/api/auth/handoff/attempts` | public auth-adjacent | public | service-level in-memory rate limit only | no shared lockout |
| `/api/auth/handoff/attempts/{attempt_id}` | public auth-adjacent | public + token header check | service-level in-memory rate limit | no shared lockout |
| `/api/auth/handoff/attempts/{attempt_id}/complete` | auth-required | bearer enforced | `_auth_context` -> `require_request_auth_context` | none |
| `/api/auth/handoff/exchange` | public handoff exchange | public | service-level in-memory rate limit | acceptable flow, but throttling is weak |
| `/api/auth/handoff/refresh` | public refresh exchange | public | service-level in-memory rate limit | acceptable flow, but logout does not revoke tokens |

## 5. Ownership / IDOR Matrix

| entity family | read path(s) | write path(s) | ownership enforcement mechanism | risk notes |
|---|---|---|---|---|
| account/profile/preferences/entitlements | `/api/me`, `/api/profile`, `/api/preferences`, `/api/entitlements/current` | `PATCH /api/profile`, `PATCH /api/preferences` | bearer auth + `user_id`-scoped canonical tables | safe in reviewed paths |
| projects | `/api/projects*` | `POST/PATCH/DELETE /api/projects*` | bearer auth + repository `user_id` filters | no direct IDOR found |
| tags | `/api/tags*` | `POST/PATCH/DELETE /api/tags*` | bearer auth + `resolve_tag_ids` ownership validation | relation-safe in reviewed paths |
| sources | `/api/sources*` | resolve-only writes via canonical services | bearer auth + `user_id` filters | no cross-user read found |
| citations | `/api/citations*` | create/update/delete + render/preview | bearer auth + `user_id` filters + owned source validation | no IDOR found |
| quotes | `/api/quotes*` | create/update/delete + quote→note | `OwnershipValidator.load_owned_quote` + `user_id`-filtered repo | tested for unowned access rejection |
| notes | `/api/notes*` | create/update/delete/archive/restore + replace tags/sources/links | `OwnershipValidator.load_owned_note` + relation validation before RPC | tested for foreign citation/source/note rejection |
| documents | `/api/docs*` | create/update/delete/archive/restore | `OwnershipValidator.load_owned_document` + revision checks | no IDOR found |
| document relations | `/api/docs/{id}/citations|notes|tags` | replace-all RPCs | parent preload + owned relation validation + atomic RPC payload includes `p_user_id` | strongest reviewed pattern |
| checkpoints | `/api/docs/{id}/checkpoints*` | create/list/restore | owned document preload + checkpoint query scoped by `user_id` | no cross-user restore path found |
| activity events/bookmarks/milestones | `/api/activity/*` | create/delete | bearer auth + repo `user_id` filters | low risk in reviewed surface |
| extension seeded work-in-editor | `/api/extension/work-in-editor` | orchestrated write chain | extension access context from bearer auth + downstream ownership checks | no direct IDOR found |

## 6. Extension Security Matrix

| surface | token handling | backend access behavior | policy drift detected | risk notes |
|---|---|---|---|---|
| background | reads/writes full session in `chrome.storage.local`; refreshes via handoff refresh API | sole runtime that performs fetches in current implementation | yes | background is network authority, but token custody is not background-only because storage is shared extension storage |
| content script | no direct token reads found; no direct fetches to backend found | communicates via runtime messages | mostly compliant | content script is not calling backend directly in reviewed code |
| popup | no direct fetches; uses runtime messages only | asks background for auth start/status/logout | compliant | UI does not directly own backend auth, but could still read shared storage if future code does |
| sidepanel | no direct fetches; uses runtime messages only | asks background for list/update/open flows | compliant | background remains API client |
| web handoff page (`/auth/handoff`) | applies returned session into browser via web auth helper | talks to backend exchange/complete flow indirectly | compatibility drift | page remains a compatibility seam and should stay minimal |

## 7. Secret / Config Exposure Review
- hardcoded secret findings
  - No hardcoded service-role keys, Paddle webhook secrets, or private API secrets found in reviewed browser/runtime code.
- weak env/default findings
  - `app/core/config.py` enforces non-wildcard CORS in staging/prod and requires billing secrets in prod.
  - No repo-side rate-limit config is attached to `/api/auth/signup` despite auth-sensitive defaults existing.
- callback/CORS/origin findings
  - CORS is explicit-origin only.
  - `validate_internal_redirect_path` and extension `_safe_redirect_path` correctly reject external/nested redirect payloads.
  - `API_ORIGIN` in the extension is pinned to `https://app.writior.com`.
- logging/redaction findings
  - `app/logging_utils.py` redacts token/secret/password/cookie patterns before logging.
  - No raw session payload logging was found in reviewed runtime code.

## 8. Dependency Risk Summary
- python packages
  - Reviewed `app/requirements.txt`; no critical/high vulnerability evidence was available locally.
  - Reachable security-sensitive packages include `fastapi`, `httpx`, `supabase`, `gotrue`, `postgrest`, and `python-multipart`.
  - No Python advisory scan tool/database was available in-repo, so this portion is version-review only.
- js packages
  - Root JS dependency set is minimal (`typescript` only in `package.json`).
  - `npm audit --omit=dev` reported 0 vulnerabilities.
- critical/high issues only
  - None evidenced from the reviewed manifest set.
- whether they are reachable in production paths
  - The only JS dependency is dev-only; Python runtime dependencies are production-reachable but no critical/high advisory evidence was surfaced in this audit pass.

## 9. Immediate Fix Queue
- P0 fix immediately before any release
  - Add server-side protection for authenticated shell pages (`/dashboard`, `/projects`, `/research`, `/editor`, `/insights`).
  - Remove browser `localStorage` persistence for web bearer/refresh tokens.
- P1 fix in next hardening pass
  - Move extension session custody out of `chrome.storage.local` and back into a background-only model.
  - Revoke Supabase sessions on extension logout and verify refresh tokens die.
  - Add shared-infrastructure rate limiting for `/api/auth/signup` and handoff/auth-attempt flows.
- P2 cleanup / debt reduction
  - Add a Python dependency advisory scan in CI.
  - Tighten explicit token lifetime controls/at-rest exposure in extension session handling.

## 10. Verified Safe Patterns
- Strict bearer parsing/verification is centralized in `app/core/auth.py`.
- Production CORS wildcard is rejected in `app/core/config.py` and enforced in `app/core/security.py`.
- Redirect validation is strong in `app/core/security.py` and `app/modules/extension/service.py`.
- Billing webhook signatures are verified before mutation in `app/modules/billing/service.py`.
- Ownership checks for notes/quotes/documents are centralized in `app/modules/common/ownership.py`.
- Replace-all document relation writes use canonical atomic RPCs in `app/modules/workspace/service.py`.
- Extension content scripts do not directly call backend APIs in the reviewed code; they message the background runtime instead.
- Logging redaction for tokens/secrets/passwords is implemented in `app/logging_utils.py`.
- HSTS/security headers are installed in `app/core/security.py`.
- Route-level bearer dependencies are consistently applied across protected API modules.

## 11. Final Verdict
- can this build be safely exposed publicly right now? no
- what 3 things most threaten it right now
  1. Publicly reachable authenticated shell pages protected only by frontend logic.
  2. Web bearer/refresh tokens persisting in `localStorage`.
  3. Extension session handling that stores refresh-capable tokens in shared extension storage and does not revoke them on logout.
