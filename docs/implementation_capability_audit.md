# Writior Implementation Capability Audit

## 1. Executive Summary

This codebase is a multi-surface research workflow product, not just an editor. The current implementation spans:

- public web unlock pages and pricing/auth entry points
- Supabase-backed auth on web and extension
- a cleaned-page unlock/render pipeline with quota enforcement and history persistence
- a dashboard with usage, momentum, monthly reports, bookmarks, recent unlocks, and citation history
- a research workspace/editor with documents, citations, quotes, notes, projects, tags, checkpoints, restore, and export
- a browser extension with local-first citation/note capture, guest unlock permits, editor handoff, note sync queues, and sidepanel/popup/content-script flows
- billing and entitlement mutation through Paddle webhooks

The product is functionally rich but operationally inconsistent. Tier enforcement is partly centralized in `app/services/entitlements.py` and `app/services/free_tier_gating.py`, but some surfaces still use older counters or local extension heuristics. The reconstruction should preserve capabilities, but not treat every current implementation detail as intentional product policy.

High-confidence truths from code:

- Authenticated users are resolved in middleware from either `Authorization: Bearer` or a legacy `wu_access_token` cookie (`app/main.py`).
- The extension owns a real auth-handoff flow into web pages using one-time `auth_handoff_codes` (`app/routes/auth_handoff.py`, `extension/background.js`).
- Unlocking exists on both web and extension, with different guest and authenticated limits (`app/routes/render.py`, `app/routes/extension.py`, `app/services/IP_usage_limit.py`).
- The editor is a real document workspace with autosave/update, citations, quote workflows, note attachment, checkpoints, restore, and export (`app/routes/editor.py`, `app/static/js/editor.js`).
- Notes, projects, tags, note sources, note links, document-note links, document-tag links, and document-citation links are all implemented server-side, though some are schema-fallback tolerant and therefore transitional (`app/routes/extension.py`, `app/services/research_entities.py`, `sql/*`).
- Billing updates `user_meta.account_type`, `paid_until`, and Paddle identifiers via webhook (`app/routes/payments.py`).

Main inconsistencies to preserve consciously, not accidentally:

- Dashboard/reporting still queries a legacy `citations` table for monthly report counts, while active citation flows now use canonical `citation_instances`/`citation_sources`/`citation_renders` (`app/routes/dashboard.py`, `app/routes/citations.py`).
- Extension local tier cache enforces some limits that do not exactly match backend limits, especially around free/standard periods and document counts (`extension/background.js` vs `app/services/free_tier_gating.py`).
- The dashboard HTML page itself is public, but its data APIs are protected and the page self-redirects client-side when unauthenticated (`app/main.py`, `app/templates/dashboard.html`).
- The home page still contains older iframe-driven unlock navigation against `/fetch_and_clean_page`, while the main unlock POST surface is `/view`; both exist (`app/templates/home.html`, `app/routes/render.py`).

## 2. Product Capability Overview

Current product abilities, grouped by user-visible function:

- Public web:
  - visit home page
  - submit URL for cleaned/unlocked rendering
  - browse pricing and auth pages
  - fetch public Supabase config bootstrap for web auth
- Auth/account:
  - email/password signup and login
  - persistent browser session via Supabase session + legacy access cookie
  - logout on extension and web auth client
  - extension-to-web auth handoff into `/editor` and `/dashboard`
- Unlock product:
  - fetch and clean article pages
  - bypass some copy restrictions by re-rendering cleaned content
  - guest unlocks with IP/day throttles on web
  - extension unlock permits for anonymous and authenticated users
  - unlock history recording with optional extension event dedupe
  - paid-tier queue priority and cloudscraper eligibility
- Dashboard/account:
  - plan and billing status view
  - unlock usage counters
  - recent unlock history
  - citation history preview
  - bookmark management
  - momentum/streaks and milestone awarding
  - monthly PDF report for paid users
- Research workspace:
  - create/list/open/update documents
  - document quotas and archive/freeze semantics
  - citation attach/replace/remove
  - tag attach/replace/remove
  - note attach/detach to document
  - checkpoints and restore
  - export as PDF, DOCX, TXT, Markdown, HTML
  - Pro ZIP export
  - Pro-only document delete
- Research entities:
  - canonical citation creation and render
  - quote creation and quote listing
  - quote-to-note creation
  - note CRUD, archive/restore, source attachments, note links
  - project CRUD
  - tag list/create
- Extension:
  - popup and sidepanel UI
  - content-script floating quick actions on text selection
  - local citation capture
  - note capture/edit/delete in local storage
  - background sync queues to server for citations, notes, and usage events
  - open authenticated editor/dashboard in web via handoff
  - local IndexedDB storage for research citations/notes

## 3. User States and Auth Model

### Auth model

Primary auth plumbing:

- Backend signup/login endpoints: `app/services/authentication.py`
- Web auth bootstrap and cookie syncing: `app/static/js/auth.js`
- Middleware token validation and tier resolution: `app/main.py`
- Extension session storage and refresh: `extension/lib/supabase.js`, `extension/background.js`
- Extension-to-web handoff: `app/routes/auth_handoff.py`, `extension/background.js`

How auth works today:

- Web auth uses Supabase JS from `/auth` and `/auth/handoff` pages.
- `app/static/js/auth.js` initializes a Supabase client from `window.*` config or `/api/public-config`.
- When a web session exists, `auth.js` mirrors the current access token into a non-HttpOnly `wu_access_token` cookie for backend middleware compatibility.
- Backend middleware accepts either:
  - `Authorization: Bearer <access_token>`
  - fallback cookie `wu_access_token`
- Middleware validates with `supabase_anon.auth.get_user(token)`, then loads `user_meta` using the service role and caches it in Redis under `user_meta:{user_id}` for 5 minutes (`app/main.py`).

### Signup

- Web API endpoint: `POST /api/signup` in `app/services/authentication.py`
- Extension signup path:
  - `supabaseClient.auth.signUp(...)` in `extension/background.js`
  - then metadata sync to backend `POST /api/signup`
- Signup writes `user_meta` with:
  - `account_type = free`
  - `daily_limit = 5`
  - `requests_today = 0`
  - `name`
  - `use_case`

### Login

- Backend login endpoint: `POST /api/login` in `app/services/authentication.py`
- It sets `wu_access_token` cookie and returns access/refresh token payload.
- Extension login uses direct Supabase password auth in `extension/lib/supabase.js`, stores session in `chrome.storage.local`, and does not depend on the backend login route.

### Logout

- No explicit backend logout route.
- Web auth client can sign out through Supabase client from `auth.js`.
- Extension logout clears stored session and local usage cache in `extension/background.js`.

### Session persistence

- Web:
  - Supabase JS session storage plus mirrored `wu_access_token` cookie
  - cookie is `httponly=False`, `secure=False`, `samesite=lax` in backend login route
- Extension:
  - session persisted in `chrome.storage.local` key `session`
  - refresh attempted when expiry is within 120 seconds (`REFRESH_WINDOW_SECONDS`)

### Route/page protection

- Public paths are broadly whitelisted in middleware:
  - `/`
  - `/auth`
  - `/static`
  - `/api/auth/handoff/exchange`
  - `/api/public-config`
  - `/webhooks/paddle`
- Middleware does not hard-block most pages; many endpoints self-enforce auth by checking `request.state.user_id`.
- `/editor` is server-protected and redirects to `/auth` if unauthenticated (`app/routes/editor.py`).
- `/dashboard` HTML is public, but its JS immediately redirects to `/auth?next=/dashboard` when it cannot fetch a token (`app/templates/dashboard.html`).

### Tier resolution

- Canonical normalization: `app/services/entitlements.py`
- Supported normalized tiers:
  - `free`
  - `standard`
  - `pro`
  - internal `dev`
- Legacy aliases:
  - `freemium -> free`
  - `premium -> standard`

### Practical states

#### Guest / anonymous

- No backend user id.
- Can use home page and attempt web unlocks under IP/day rate limits.
- Can use extension unlock permits anonymously, with anonymous ID + IP binding limits.
- Cannot use editor, dashboard APIs, notes/citations/projects/tags APIs, or auth handoff.

#### Authenticated free

- Has Supabase session plus `user_meta.account_type = free`.
- Can unlock pages on web with weekly unlock limits.
- Can access editor and create documents, but is constrained by weekly document quota and archived/frozen documents.
- Can create and use notes/citations/quotes/projects/tags.
- Cannot use bookmarks/history search/paid reports/custom citation templates/ZIP export/document delete.

#### Standard

- Paid tier with daily unlock limit and 14-day document quota.
- Can use bookmarks, history search, paid reports, more export formats, more citation formats.
- Still subject to document freeze/archive behavior and cannot delete documents or ZIP export.

#### Pro

- Unlimited unlocks and no document quota freeze.
- Can delete documents, ZIP export, and use custom citation templates.
- Full bookmarks/history/reporting access.

#### Dev

- Internal tier treated operationally like Pro with metrics endpoint access.
- Should be documented during reconstruction, but not treated as a public product plan.

## 4. Guest Capabilities

Confirmed guest abilities:

- Visit `/` and load the public home page (`app/main.py`, `app/templates/home.html`).
- Visit `/auth`, `/login`, `/signin`, `/auth/login`, and `/static/pricing.html`.
- Load `/api/public-config` to bootstrap web Supabase auth.
- Submit a URL through home page UI and render cleaned page content through `/view` or `/fetch_and_clean_page` without being logged in (`app/templates/home.html`, `app/routes/render.py`).
- Use browser extension anonymous unlock permit checks via `POST /api/extension/unlock-permit` with `X-Extension-Anon-Id`.

Guest boundaries:

- Web unlock guest enforcement is IP-based:
  - 3 requests/minute rate limit
  - 5 uses/day max
  - persisted to `ip_usage` table plus Redis rate-limit keys (`app/services/IP_usage_limit.py`)
- Guest web unlock cannot use cloudscraper.
- Guest web unlock does not write `unlock_history` because there is no user id.
- Guest extension unlock permit is separate:
  - 5 unlocks/week per anonymous extension identity
  - identity must remain bound to the same IP for the week
  - rate limit 10 requests/minute per IP+anon-id pair
- Guests cannot access:
  - dashboard APIs
  - editor
  - notes/citations/projects/tags endpoints
  - monthly reports
  - auth handoff

## 5. Authenticated Free Capabilities

Confirmed free-tier abilities:

- Web/page unlock on authenticated surfaces with weekly quota (`FREE_UNLOCKS_PER_WEEK = 10`) via `check_login` in `app/services/IP_usage_limit.py`.
- Editor access via `/editor` and `/api/editor/access`.
- Create up to 3 active documents per current week (`app/services/free_tier_gating.py`, `app/routes/editor.py`).
- Existing documents older than the active window become archived and non-editable.
- Export documents in `pdf` and `html`.
- Use citation styles `apa` and `mla`.
- Create/list/update citations, render citations, create/list quotes, and create quote-linked notes (`app/routes/citations.py`).
- Create/list/update/delete/archive/restore notes plus note sources and note links (`app/routes/extension.py`).
- Create/list projects and tags.
- View limited unlock history (`/api/unlocks`, default or capped at 5 for free users).
- View dashboard metadata and momentum.

Free-tier restrictions:

- No bookmarks (`app/routes/bookmarks.py`).
- No history search (`app/routes/search.py`).
- No monthly reports (`app/routes/dashboard.py`).
- No custom citation templates.
- No DOCX/TXT/Markdown export.
- No ZIP export.
- No document delete.
- Document freeze is active.

Important inconsistency:

- The extension’s local tier cache models authenticated free as:
  - 10 citations
  - 3 documents
  - reset every 24h
- Backend models free as:
  - 10 unlocks/week
  - 3 documents/week
- This is not a shared canonical policy today (`extension/background.js`, `app/services/free_tier_gating.py`).

## 6. Standard Capabilities

Confirmed Standard abilities:

- Unlock pages on paid path with daily unlock window of 15 (`app/services/entitlements.py`, `app/services/free_tier_gating.py`).
- Paid queue priority 1 for unlock fetches (`app/services/entitlements.py`).
- Can use cloudscraper-backed fetching (`can_use_cloudscraper`).
- 15 documents per rolling 14-day period; documents outside the active window are frozen/archived.
- Export formats: `pdf`, `docx`, `txt`, `md`, `html`.
- Citation formats: `apa`, `mla`, `chicago`, `harvard`.
- Access bookmarks, history search, dashboard monthly reports.
- Use extension and editor flows with paid entitlements.

Standard restrictions:

- Still has unlock limits.
- Still has document quota and freeze behavior.
- Cannot delete documents.
- Cannot ZIP export.
- Cannot use custom citation templates.

## 7. Pro Capabilities

Confirmed Pro abilities:

- Unlimited unlocks and no unlock usage window.
- Queue priority 0.
- No document quota, no freeze/archive based on age.
- Can delete documents.
- Can ZIP export all documents.
- Can use all supported citation formats including `custom` in capabilities, though current create path treats `custom` as deprecated in metadata-first citation architecture (`app/routes/citations.py`).
- Can use custom citation template CRUD endpoints.
- Full dashboard/reporting/bookmarks/history search access.

Note on Pro custom citation behavior:

- `app/services/entitlements.py` and template routes explicitly grant Pro custom templates.
- `create_citation` still rejects live `custom` citation creation with a deprecation message in the metadata-first architecture.
- Result: custom templates are implemented as account capability and CRUD resource, but live citation-generation usage is transitional, not fully active.

## 8. Public Web Product Abilities

### Home page

Primary file: `app/templates/home.html`

Public abilities:

- URL entry field
- unlock-mode checkbox
- iframe display of cleaned page output
- dynamic recleaning on in-iframe navigation using `postMessage`

Primary routes called:

- `POST /view`
- `POST /fetch_and_clean_page`

### Auth page

Primary route/page:

- `GET /auth`
- template `app/templates/auth.html`
- client `app/static/js/auth.js`

Abilities:

- signup
- login
- Supabase session bootstrap
- token-cookie sync
- `next` redirect support from other surfaces

### Pricing page

- Static page at `/static/pricing.html`
- Used as the upgrade target from dashboard/editor/blocked messages.

### Dashboard page exposure

- `GET /dashboard` serves HTML to anyone.
- Actual user data loads only through authenticated API calls from client-side JS.

### Public config

- `GET /api/public-config`
- Exposes Supabase URL and anon key for web auth bootstrap.

## 9. Unlock Product Abilities

### Main web unlock flow

Primary backend: `app/routes/render.py`
Primary service: `app/services/unprotector.py`
Primary page: `app/templates/home.html`

Implemented flow:

1. Home page posts `url` and `unlock` to `/view`.
2. Route calls `check_login(...)`.
3. Guest users go through IP/day gates.
4. Authenticated users go through user/tier-based limits and rate limits.
5. `fetch_and_clean_page(...)` runs the cleaning pipeline with cache lookup, queue limiter, and optional cloudscraper.
6. Authenticated requests write `unlock_history`.
7. HTML is returned and rendered in iframe/blob URL.

### Unlock limits and throttles

Web unlock enforcement:

- guest:
  - `rate_limit:{ip}` in Redis, 3/min
  - `ip_usage` table, 5/day
- authenticated free:
  - `rate_limit:user:{user_id}` in Redis, 3/min
  - `user_usage_week:{user_id}:{week}` in Redis, 10/week
- authenticated standard/pro/dev:
  - `rate_limit:user:{user_id}` in Redis, 3/min
  - `user_usage_week:{user_id}:{week}` in Redis, 200/week in `check_login`

Important inconsistency:

- Core entitlement capabilities define Standard as 15/day unlocks and Pro unlimited.
- `check_login` in `app/services/IP_usage_limit.py` still allows `standard|pro|dev` up to `MAX_WEEKLY_USES = 200`.
- Extension unlock permit endpoint uses the newer entitlements-based model.
- Result: web unlock quotas are partially legacy and do not fully match the newer entitlement table.

### Unlock history persistence

Persistence:

- table `unlock_history`
- insert helper `save_unlock_history(...)` in `app/routes/render.py`

Stored fields from code:

- `id`
- `user_id`
- `url`
- `unlocked_at`
- `source` (`web` or `extension`)
- `event_id` optional

Extension usage-event dedupe:

- `POST /api/extension/usage-event`
- `save_unlock_history` uses `on_conflict=user_id,event_id`
- if unique index missing, code falls back to manual duplicate detection
- requires migration `sql/20260206_add_extension_usage_event_id.sql`

### Queue priority and fetch behavior

- `queue_priority(account_type)` comes from `app/services/entitlements.py`
- passed into `PriorityLimiter` in unlock pipeline
- free queue priority 2, standard 1, pro/dev 0
- `can_use_cloudscraper(account_type)` allows standard/pro/dev only

### Extension-assisted unlock behavior

The extension does not fetch cleaned HTML itself. It:

- checks unlock allowance through `/api/extension/unlock-permit`
- can log usage events through `/api/extension/usage-event`
- uses content-script affordances to enable copy/citation/note flows on the original page

## 10. Dashboard and Account Abilities

Primary backend: `app/routes/dashboard.py`
Primary page: `app/templates/dashboard.html`

### `/api/me`

Provides dashboard bootstrap payload:

- `user_id`
- `name`
- `use_case`
- `account_type`
- `daily_limit`
- `requests_today`
- `paid_until`
- `auto_renew`
- billing-profile presence
- subscription active boolean
- bookmarks list
- usage count
- usage limit
- usage period

Also marks degraded responses with `206` and `degraded_reasons` when bookmarks cannot load.

### Momentum

Route: `GET /api/dashboard/momentum`

Abilities:

- current streak days
- whether user unlocked today
- month-to-date unlock count
- all-time unlock count
- active days in current month
- milestone awarding into `user_milestones`

Persistence:

- `unlock_history`
- RPC `get_unlock_days`
- `user_milestones`

### Monthly reports

Route: `GET /api/reports/monthly`

Paid-only:

- Standard, Pro, Dev

Builds a monthly PDF report including:

- unlock counts
- streak data
- citation counts
- domain breakdown RPCs

Important transitional detail:

- It counts citations from table `citations` by `cited_at`, but active citation flow now writes canonical citation data into `citation_instances` and related tables.
- This means reporting is implementation-real but partly attached to an older schema assumption.

### Dashboard UI abilities

From `app/templates/dashboard.html`:

- usage header with plan and unlock counter
- recent unlock list
- citation history library
- bookmarks add/delete/list
- subscription and billing status display
- theme toggle
- monthly PDF download
- words typed and notes created are present in UI, but words typed is explicitly “Coming soon” and notes-created is hardcoded `0`

### Bookmarks

Routes: `/api/bookmarks`

- Standard/Pro/Dev only
- add/list/delete bookmarks
- dashboard exposes bookmark count and domain list

## 11. Editor and Workspace Abilities

Primary backend: `app/routes/editor.py`
Primary page/runtime: `app/templates/editor.html`, `app/static/js/editor.js`, `app/static/js/editor_runtime/*`

### Document create/list/open/update/delete

Implemented:

- `POST /api/docs`
- `GET /api/docs`
- `GET /api/docs/{doc_id}`
- `PUT /api/docs/{doc_id}`
- `DELETE /api/docs/{doc_id}`

Behavior:

- create initializes empty Quill doc state
- list supports `view=summary`
- expired docs are filtered using `expires_at` when schema supports it
- update stores both `content_delta` and `content_html`
- delete is Pro-only

Status: solid

### Autosave and sync

Editor runtime has:

- autosave debounce
- periodic sync
- dirty-state tracking
- local recovery key `editor_local_docs_v1`
- manual sync button

Persistence path is still server document update APIs, but runtime clearly implements autosave/session logic in `app/static/js/editor.js`.

Status: solid on client runtime, though this audit did not enumerate every helper in `editor_runtime/*`.

### Checkpoints and restore

Routes:

- `GET /api/docs/{doc_id}/checkpoints`
- `POST /api/docs/{doc_id}/checkpoints`
- `POST /api/docs/{doc_id}/restore`

Behavior:

- checkpoint stores `content_delta`, optional `content_html`, and timestamp
- restore overwrites document content from checkpoint
- archived/frozen documents cannot create or restore checkpoints
- if `doc_checkpoints` table is absent, create returns `{created: false, reason: "checkpoints_not_configured"}`

Status: implemented, but schema-tolerant and therefore somewhat transitional.

### Document switching

Confirmed in editor runtime:

- document list sidebar
- open doc request sequencing
- current doc state tracking

Status: solid

### Citation insertion

Implemented surfaces:

- citation library tab
- in-doc citation management APIs
- toolbar buttons: `Cite`, `Quick Cite`, `Bibliography`, `Insert Quote`
- attach/replace/remove citation links through document APIs

Status: solid, with canonical citation backend.

### Note creation/attachment

Implemented:

- document-note list and attach modal in editor UI
- APIs:
  - `GET /api/docs/{doc_id}/notes`
  - `POST /api/docs/{doc_id}/notes`
  - `DELETE /api/docs/{doc_id}/notes/{note_id}`

Behavior:

- validates note ownership
- uses `document_notes` join table
- returns schema-missing 503 payload if migration is absent

Status: implemented but transitional because route explicitly tolerates missing schema.

### Projects and tags in editor

Document records can carry:

- `project_id`
- `tag_ids`

Server behavior:

- create/update validates project ownership
- create/update can create missing tags by name via `ensure_tags`
- tag link persistence uses canonical join/RPC helpers

Status: solid

### Export

Routes:

- `POST /api/docs/{doc_id}/export`
- `GET /api/docs/{doc_id}/export/file`
- `GET /api/docs/export/zip`

Formats:

- free: `pdf`, `html`
- standard: `pdf`, `docx`, `txt`, `md`, `html`
- pro/dev: same plus ZIP export

Behavior:

- generates bibliography from attached citation records
- exports sanitized HTML/text
- supports PDF, Markdown, DOCX, HTML, TXT
- ZIP export packages up to 1000 docs with `original.txt`, `pdf_render.html`, `citations.txt`, and manifest

Status: solid

### Archive/freeze behavior

Implemented in `app/services/free_tier_gating.py` and enforced in editor routes.

Behavior:

- free and standard docs can age out of the editable window
- archived docs remain listable but become non-editable
- exports still work on archived docs if format is allowed
- message:
  - `"This document is archived. Upgrade to Pro to restore editing."`

Status: solid, likely worth preserving as a capability if not as current policy wording.

## 12. Research Entity Abilities

### Citations

Primary backend: `app/routes/citations.py`

Current canonical model uses:

- `citation_sources`
- `citation_instances`
- `citation_renders`

Abilities:

- create citation from raw payload and metadata
- render citation without persisting
- list citations
- fetch citations by ids
- delete citation instance

User interaction today:

- web editor citation library
- extension content-script save citation
- note-to-citation conversion
- extension work-in-editor can seed a new document with a citation attached

### Citation templates

Routes:

- `GET/POST/PUT/DELETE /api/citation-templates`

Tier gating:

- Pro only

Status:

- CRUD is implemented and real
- live `custom` citation generation is currently de-emphasized/deprecated in main create flow

### Quotes

Routes:

- `GET /api/quotes`
- `POST /api/quotes`
- `POST /api/quotes/{quote_id}/notes`

Abilities:

- create quotes linked to citations
- list quotes by:
  - citation
  - document
  - explicit ids
- hydrate quotes with citation and note relationships
- create note from quote with deterministic defaults and optional project/tags

Status: solid

### Notes

Routes live in `app/routes/extension.py`, but they are product APIs, not extension-only internals:

- `POST /api/notes`
- `GET /api/notes`
- `PATCH /api/notes`
- `DELETE /api/notes/{note_id}`
- `POST /api/notes/{note_id}/archive`
- `POST /api/notes/{note_id}/restore`
- `POST /api/notes/{note_id}/citation`
- `GET /api/notes/{note_id}/sources`
- `POST /api/notes/{note_id}/sources`
- `POST /api/notes/{note_id}/links`

Abilities:

- note CRUD
- archive/restore
- tag links
- project assignment
- citation linkage
- quote linkage
- multiple attached sources
- note-to-note links
- filtered search by tag/project/source/full-text vector/citation/archive state

Status: solid, though located in the extension route module.

### Projects

Routes:

- `GET/POST/DELETE /api/projects`
- aliases under `/api/note-projects`

Abilities:

- create/list/delete projects
- reuse existing project by case-insensitive name

Status: solid

### Tags

Routes:

- `GET/POST /api/tags`

Abilities:

- list tags
- create-or-reuse tag by name
- document and note tag assignment through relation helpers

Status: solid

### Join/link entities

Implemented join capabilities:

- `document_citations`
- `document_tags`
- `document_notes`
- `note_tag_links`
- `note_sources`
- `note_links`

Atomic replacement RPCs used:

- `replace_document_citations_atomic`
- `replace_document_tags_atomic`
- `replace_note_tag_links_atomic`
- `replace_note_sources_atomic`
- `replace_note_links_atomic`

Status: real and important, but still transitional because some routes explicitly surface migration-missing behavior.

## 13. Extension Abilities

Primary files:

- `extension/background.js`
- `extension/popup.js`
- `extension/sidepanel.js`
- `extension/content/unlock_content.js`
- `extension/lib/api.js`
- `extension/lib/supabase.js`
- `extension/lib/note_sync.js`

### Auth/session handling

Implemented:

- direct Supabase signup/login/password flows
- local session storage in `chrome.storage.local`
- refresh-token based renewal
- `get-session`, `logout`, and auth-state-change messaging

### Web-auth handoff

Implemented flow:

1. Extension ensures valid session.
2. Calls `POST /api/auth/handoff` with access token, refresh token, redirect path, expiry metadata.
3. Backend stores one-time code in `auth_handoff_codes`.
4. Extension opens `${BACKEND_BASE_URL}/auth/handoff?code=...`.
5. Web page exchanges code via `/api/auth/handoff/exchange` and establishes browser session.

Used for:

- open editor
- open dashboard
- work-in-editor handoff after extension selection capture

Status: solid and important to preserve.

### Content-script selection capture

`extension/content/unlock_content.js` implements:

- selection detection
- inline floating action pill
- metadata extraction from page DOM, meta tags, schema.org, citation tags
- citation formatting helpers
- actions to:
  - render citation
  - save citation
  - work in editor
  - create note
  - copy plain selection

Status: solid

### Citation creation

Flow:

- content script sends `SAVE_CITATION`
- background consumes local tier credit
- citation is stored locally in IndexedDB `citations`
- background queues remote sync to `POST /api/citations`

Capabilities:

- local-first save
- background sync retry queue
- recent citation retrieval from backend for signed-in users

Status: solid, but local-first policy is partially independent from backend entitlements.

### Note creation and local-first note system

Capabilities:

- popup and sidepanel list notes
- create/edit/delete notes locally
- filter by tag/project/source
- inline quick note capture from content script
- local projects/tags state in `chrome.storage.local`
- background sync queue to server note APIs

Local persistence:

- `notes_state`
- `notes_sync_queue`
- `background_sync_queue`
- IndexedDB `notes` object store for research state

Sync behavior:

- notes are always saved locally first
- if signed in and storage-size cap not exceeded, queued for remote sync

Storage cap by extension tier cache:

- free authenticated: 5 MB
- standard: 10 MB
- pro: 30 MB
- guests: effectively unlimited local-only because sync disabled

Status: solid but policy-heavy and partly local-only.

### Open in editor / work in editor

Implemented:

- content script sends `WORK_IN_EDITOR`
- background may locally gate document credits first
- backend `POST /api/extension/selection`:
  - validates auth
  - enforces backend extension editor limit
  - checks document quota
  - optionally creates citation
  - creates document seeded with selected text
  - links citation to document
  - returns `editor_url`
- extension then performs auth handoff and opens web editor

Status: solid and a key cross-surface workflow.

### Copy/plain-text actions

Implemented in content script:

- copy selected text
- render and copy citation text
- save citation for later

Status: solid

### Unlock/copy restriction handling

Implemented extension behavior:

- CSS injection to force text selection and user-select
- floating action controls on selected text
- unlock permit checks
- usage-event logging

The extension does not itself return a cleaned page; it works on top of the original page surface and permission system.

### Usage event recording

Implemented:

- background queues `usage_event`
- remote endpoint `POST /api/extension/usage-event`
- inserts `unlock_history` row with `source="extension"` and dedupe `event_id`

Status: solid

### Project/tag resolution owned by extension

Background sync resolves local names to canonical remote ids before note sync:

- `ensureRemoteProjectId`
- `ensureRemoteTagIds`

This is real business logic currently owned by the extension.

### Popup vs sidepanel vs content script

- popup:
  - auth UI
  - usage snapshot
  - recent citations
  - local notes
  - open editor/dashboard
- sidepanel:
  - same general abilities as popup with richer persistent workspace UX
  - sync status indicators
  - collapse/open handling via `chrome.sidePanel`
- content script:
  - selection capture and page metadata extraction
  - inline actions on arbitrary pages
- background:
  - auth/session authority
  - network/API authority
  - queue processing
  - auth handoff
  - local tier cache

## 14. Billing, Quotas, and Entitlements

### Central entitlement model

Primary files:

- `app/services/entitlements.py`
- `app/services/free_tier_gating.py`

Canonical capability table today:

| Tier | Unlock limit | Document limit | Freeze docs | Delete docs | Export formats | ZIP export | Citation styles | Custom templates |
|---|---|---:|---|---|---|---|---|---|
| Free | 10/week | 3/week | Yes | No | pdf, html | No | apa, mla | No |
| Standard | 15/day | 15 per 14 days | Yes | No | pdf, docx, txt, md, html | No | apa, mla, chicago, harvard | No |
| Pro | Unlimited | Unlimited | No | Yes | pdf, docx, txt, md, html | Yes | apa, mla, chicago, harvard, custom | Yes |
| Dev | Unlimited | Unlimited | No | Yes | pdf, docx, txt, md, html | Yes | apa, mla, chicago, harvard, custom | Yes |

### Scattered checks

Entitlement checks are not fully centralized. Current additional scattered enforcement includes:

- `check_login` uses legacy weekly count for `standard|pro|dev` web unlocks
- `/api/unlocks` caps free history to 5, paid to 100
- bookmarks/history search are checked separately by helper booleans
- monthly reports are gated directly to paid tiers
- extension local tier cache separately consumes citation/document credits before server request
- extension selection route uses `EXTENSION_EDITOR_WEEKLY_LIMIT = 500` for limited tiers

### Billing

Primary file: `app/routes/payments.py`

Implemented billing abilities:

- `GET /get_paddle_token`
- `POST /create_paddle_checkout`
- `POST /webhooks/paddle`

Paddle plan mapping:

- Standard monthly / quarterly price ids
- Pro monthly / quarterly price ids

Webhook effects on `user_meta`:

- set `account_type`
- set/clear `paid_until`
- set `auto_renew`
- set `paddle_customer_id`
- set `paddle_subscription_id`
- set `paddle_price_id`

Redis cache update:

- `user_meta:{user_id}` refreshed with account_type and paid_until

### Ads / no-ads

- `should_show_ads(account_type)` exists in `app/services/entitlements.py`
- returns true only for `free`
- no major ad-rendering surface was audited in current UI templates
- treat as a weak/backend capability rather than a clearly exposed product feature

## 15. Cross-Surface Workflows

### Extension selection -> web editor

Files:

- `extension/content/unlock_content.js`
- `extension/background.js`
- `app/routes/extension.py`
- `app/routes/auth_handoff.py`

Flow:

1. User selects text on a page.
2. Content script extracts metadata and sends `WORK_IN_EDITOR`.
3. Background ensures extension session.
4. Background optionally local-gates document credits.
5. Backend `/api/extension/selection` creates citation and document.
6. Background requests auth handoff code for returned editor path.
7. New browser tab opens on `/auth/handoff?code=...`.
8. Web page exchanges code, sets session, redirects to `/editor?doc=...`.

### Extension save citation

1. Content script extracts citation metadata.
2. Background consumes local citation credit.
3. Citation saved locally in IndexedDB.
4. Background queues remote `POST /api/citations`.

### Extension note capture -> backend note graph

1. Note saved locally in `notes_state`.
2. If authenticated and under local storage cap, sync queue receives create/update/delete.
3. Background resolves project/tag names to remote ids.
4. Remote `/api/notes` or `PATCH /api/notes` persists note.
5. Remote note tag/source/link replacement APIs reconcile canonical relations.

### Home unlock -> dashboard/reporting

1. User unlocks via `/view`.
2. Authenticated requests write `unlock_history`.
3. Dashboard recent unlocks, momentum streaks, and monthly reports read from `unlock_history` and related RPCs.

### Quote -> note

1. Citation exists.
2. User creates quote via `/api/quotes`.
3. User creates note from quote via `/api/quotes/{quote_id}/notes`.
4. Note is linked to citation and quote, with optional project/tags.

### Note -> citation

1. Note exists without `citation_id`.
2. `POST /api/notes/{note_id}/citation`
3. Backend builds citation from note source/highlight/body/title.
4. Note patched with returned `citation_id`.

## 16. Transitional / Partial / Hidden Features

### Definitely transitional or weak

- Dashboard monthly citation counts still read legacy `citations` table instead of canonical citation tables.
- Custom citation template CRUD is real, but live custom-style generation is effectively deprecated in create flow.
- Document-note linking is implemented but route explicitly tolerates schema-missing migration state.
- Checkpoints are implemented but tolerant of missing `doc_checkpoints` table.
- Home page still uses iframe/postMessage flow and older `/fetch_and_clean_page` path alongside `/view`.
- `should_show_ads` exists but no strong UI exposure was found.
- Dashboard “Words Typed” and “Notes Created” widgets are UI placeholders, not backed by real metrics.

### Hidden/backend-only or lightly exposed

- `GET /metrics` exists for `dev` only.
- `GET /dashboard/metrics` HTML exists.
- internal request/route/dependency metrics are instrumented in middleware and services.

### Extension-specific architectural workarounds

- local tier cache and local credit consumption before server request
- local sync storage byte caps by tier
- local notes/projects/tags shadow state that later resolves to canonical remote ids

These are current capabilities because users experience them, but they are implementation workarounds more than stable product policy.

## 17. Feature Preservation Recommendations

### Preserve

- auth handoff between extension and web
- unlock history and source attribution (`web` vs `extension`)
- queue-prioritized unlock pipeline with paid fetch advantages
- editor document workspace including quotas/freeze semantics if the product still wants time-window plans
- canonical research entity graph:
  - citations
  - quotes
  - notes
  - projects
  - tags
  - note sources
  - note links
  - document-note/citation/tag links
- document export formats and Pro ZIP export
- extension local-first note/citation capture
- quote-to-note and note-to-citation flows
- dashboard momentum and monthly reporting concept

### Redesign

- scattered entitlement checks across middleware, editor routes, dashboard, extension, and local caches
- dashboard/reporting metrics sources, especially citation counting
- home unlock iframe architecture and duplicated render endpoints
- extension local tier cache policy so it matches server truth
- legacy access-token cookie strategy if security hardening is desired
- note/project/tag APIs currently housed under `extension.py`

### Probably drop or demote

- legacy/placeholder dashboard metrics with no backend support
- any reliance on legacy `citations` table once reporting is rebuilt on canonical tables
- old fallback schema contracts once reconstruction removes migration drift

## 18. Capability Matrix Appendix

| Feature | Allowed tiers/states | Surface | Primary entry | Primary API/routes | Persistence | Status | Recommendation |
|---|---|---|---|---|---|---|---|
| Public home unlock page | Guest, all auth tiers | Web | `/` | `/view`, `/fetch_and_clean_page` | Redis cache/rate-limit, `ip_usage`, `unlock_history` for auth | solid | Preserve |
| Guest web unlock | Guest | Web | `/` | `/view` | `ip_usage`, Redis `rate_limit:{ip}` | solid | Preserve |
| Authenticated web unlock | Free, Standard, Pro, Dev | Web | `/`, iframe flow | `/view` | Redis `user_usage*`, `unlock_history` | transitional | Redesign |
| Extension guest unlock permit | Guest | Extension | content script/background | `/api/extension/unlock-permit` | Redis `extension_usage_week:anonymous:*`, anon binding keys | solid | Preserve |
| Extension authenticated unlock permit | Free, Standard, Pro, Dev | Extension | background | `/api/extension/unlock-permit` | Redis `extension_usage_day/week:*` | solid | Preserve |
| Unlock history list | Free, Standard, Pro, Dev | Web | dashboard | `/api/unlocks` | `unlock_history` | solid | Preserve |
| History search | Standard, Pro, Dev | Web | dashboard/editor-linked flows | `/api/history` | `unlock_history` | solid | Preserve |
| Bookmarks | Standard, Pro, Dev | Web | dashboard | `/api/bookmarks` | `bookmarks` | solid | Preserve |
| Dashboard metadata | Free, Standard, Pro, Dev | Web | `/dashboard` | `/api/me` | `user_meta`, bookmarks, Redis usage keys | solid | Preserve |
| Momentum streaks | Free, Standard, Pro, Dev | Web | `/dashboard` | `/api/dashboard/momentum` | `unlock_history`, `user_milestones`, RPC `get_unlock_days` | solid | Preserve |
| Monthly PDF report | Standard, Pro, Dev | Web | dashboard | `/api/reports/monthly` | `unlock_history`, legacy `citations`, RPC monthly funcs | partial | Redesign |
| Editor access | Free, Standard, Pro, Dev | Web | `/editor` | `/api/editor/access` | `user_meta`, `documents` | solid | Preserve |
| Document CRUD | Free, Standard, Pro, Dev; delete Pro/Dev only | Web | editor | `/api/docs*` | `documents` | solid | Preserve |
| Document quota/freeze | Free, Standard | Web | editor | `/api/editor/access`, `/api/docs*` | `documents`, entitlement helpers | solid | Preserve |
| Document checkpoints | Free, Standard, Pro, Dev | Web | editor history panel | `/api/docs/{id}/checkpoints`, `/restore` | `doc_checkpoints` | partial | Preserve |
| Document export single | Free, Standard, Pro, Dev | Web | editor export modal | `/api/docs/{id}/export`, `/export/file` | `documents`, `document_citations`, citation tables | solid | Preserve |
| ZIP export all docs | Pro, Dev | Web | editor export | `/api/docs/export/zip` | `documents`, `document_citations`, citation tables | solid | Preserve |
| Citation create/render/list | Free, Standard, Pro, Dev | Both | editor, extension | `/api/citations`, `/api/citations/render`, `/api/citations/by_ids` | `citation_sources`, `citation_instances`, `citation_renders` | solid | Preserve |
| Citation template CRUD | Pro, Dev | Web | no major UI found | `/api/citation-templates*` | `citation_templates` | partial | Redesign |
| Quote CRUD/list | Free, Standard, Pro, Dev | Web | editor | `/api/quotes*` | `quotes`, citation tables, note relations | solid | Preserve |
| Quote-to-note | Free, Standard, Pro, Dev | Web | editor | `/api/quotes/{id}/notes` | `notes`, `note_tag_links`, projects | solid | Preserve |
| Notes CRUD | Free, Standard, Pro, Dev | Both | extension popup/sidepanel, editor note lists | `/api/notes*` | `notes`, `note_tag_links`, `note_sources`, `note_links` | solid | Preserve |
| Note archive/restore | Free, Standard, Pro, Dev | Both | extension/editor | `/api/notes/{id}/archive`, `/restore` | `notes.archived_at` | solid | Preserve |
| Note sources | Free, Standard, Pro, Dev | Both | extension/editor | `/api/notes/{id}/sources*` | `note_sources` | solid | Preserve |
| Note links | Free, Standard, Pro, Dev | Both | extension/editor | `/api/notes/{id}/links` | `note_links` | solid | Preserve |
| Note-to-citation | Free, Standard, Pro, Dev | Both | extension/editor | `/api/notes/{id}/citation` | `notes`, citation tables | solid | Preserve |
| Projects | Free, Standard, Pro, Dev | Both | editor/extension | `/api/projects*`, `/api/note-projects*` | `projects` | solid | Preserve |
| Tags | Free, Standard, Pro, Dev | Both | editor/extension | `/api/tags*` | `tags`, link tables | solid | Preserve |
| Document-note links | Free, Standard, Pro, Dev | Web | editor | `/api/docs/{id}/notes*` | `document_notes` | transitional | Preserve |
| Document-tag links | Free, Standard, Pro, Dev | Web | editor | `/api/docs/{id}/tags*` | `document_tags`, atomic RPC | solid | Preserve |
| Document-citation links | Free, Standard, Pro, Dev | Web | editor | `/api/docs/{id}/citations*` | `document_citations`, atomic RPC | solid | Preserve |
| Extension auth | Auth users | Extension | popup/sidepanel | background message handlers | `chrome.storage.local.session` | solid | Preserve |
| Extension auth handoff | Auth users | Both | popup/sidepanel/content script | `/api/auth/handoff`, `/api/auth/handoff/exchange` | `auth_handoff_codes` | solid | Preserve |
| Extension local notes workspace | Guest and auth users | Extension | popup/sidepanel | local message handlers | `notes_state`, IndexedDB `notes` | solid | Preserve |
| Extension local citations cache | Guest and auth users | Extension | content/popup/sidepanel | local message handlers | IndexedDB `citations` | solid | Preserve |
| Extension background sync queues | Auth users | Extension | background | `/api/citations`, `/api/notes`, `/api/extension/usage-event` | `notes_sync_queue`, `background_sync_queue` | solid | Preserve |
| Billing checkout | Auth users | Web | pricing/dashboard | `/get_paddle_token`, `/create_paddle_checkout` | Paddle + `user_meta` | solid | Preserve |
| Billing webhook entitlement mutation | system | Backend | webhook | `/webhooks/paddle` | `user_meta` | solid | Preserve |

## 19. Route/Page/Script Appendix

### Major web pages

| Surface | File | Backing data/actions |
|---|---|---|
| Home | `app/templates/home.html` | `/view`, `/fetch_and_clean_page`, unlock iframe rendering |
| Auth | `app/templates/auth.html` | Supabase auth bootstrap, `/api/public-config` |
| Auth handoff | `app/templates/auth_handoff.html` | `/api/auth/handoff/exchange` |
| Dashboard | `app/templates/dashboard.html` | `/api/me`, `/api/dashboard/momentum`, `/api/unlocks`, `/api/citations`, `/api/bookmarks`, `/api/reports/monthly` |
| Editor | `app/templates/editor.html` | `/api/editor/access`, `/api/docs*`, `/api/citations*`, `/api/quotes*`, `/api/notes*`, `/api/projects*`, `/api/tags*` |
| Pricing | `app/static/pricing.html` | static marketing/upgrade surface |

### Major backend route groups

| Module | Key routes |
|---|---|
| `app/services/authentication.py` | `/api/signup`, `/api/login` |
| `app/routes/auth_handoff.py` | `/api/auth/handoff`, `/api/auth/handoff/exchange` |
| `app/routes/render.py` | `/view`, `/fetch_and_clean_page` |
| `app/routes/dashboard.py` | `/api/me`, `/api/dashboard/momentum`, `/api/reports/monthly` |
| `app/routes/history.py` | `/api/unlocks` |
| `app/routes/search.py` | `/api/history` |
| `app/routes/bookmarks.py` | `/api/bookmarks` |
| `app/routes/editor.py` | `/editor`, `/api/editor/access`, `/api/docs*` |
| `app/routes/citations.py` | `/api/citations*`, `/api/quotes*`, `/api/citation-templates*` |
| `app/routes/extension.py` | `/api/extension/*`, `/api/notes*`, `/api/projects*`, `/api/tags*` |
| `app/routes/payments.py` | `/get_paddle_token`, `/create_paddle_checkout`, `/webhooks/paddle` |

### Major extension scripts

| Script | Role |
|---|---|
| `extension/background.js` | auth authority, message router, sync queues, handoff opener, local tier cache |
| `extension/content/unlock_content.js` | selection capture, metadata extraction, floating actions, copy/cite/note/editor actions |
| `extension/popup.js` | popup UI for auth, usage, citations, notes, open editor/dashboard |
| `extension/sidepanel.js` | persistent sidepanel workspace for notes/citations/auth actions |
| `extension/lib/api.js` | backend fetch wrapper with anon usage id header |
| `extension/lib/supabase.js` | extension-local auth client |
| `extension/lib/note_sync.js` | note payload normalization for background sync |

## 20. Table/RPC/Storage Appendix

### Supabase tables confirmed in implementation

| Table / store | Purpose today |
|---|---|
| `user_meta` | name, use_case, account_type, limits, paid_until, auto_renew, Paddle ids |
| `unlock_history` | authenticated unlock history from web and extension |
| `ip_usage` | guest web unlock daily tracking |
| `bookmarks` | saved bookmark URLs/domains |
| `documents` | editor documents |
| `doc_checkpoints` | document snapshots for restore |
| `document_citations` | document-citation join |
| `document_tags` | document-tag join |
| `document_notes` | document-note join |
| `citation_sources` | canonical citation source records |
| `citation_instances` | per-user citation instances |
| `citation_renders` | rendered outputs/cache by style/render kind |
| `citation_templates` | Pro custom template CRUD |
| `quotes` | quote entities linked to citations |
| `notes` | research notes |
| `note_tag_links` | note-tag join |
| `note_sources` | attached note sources |
| `note_links` | note-to-note links |
| `projects` | research projects |
| `tags` | user tags |
| `user_milestones` | awarded momentum milestones |
| `auth_handoff_codes` | one-time extension-to-web auth handoff records |

### RPCs confirmed in use

| RPC | Used by | Purpose |
|---|---|---|
| `get_unlock_days` | dashboard momentum | distinct unlock days for streaks |
| `get_monthly_domain_counts` | monthly reports | domain breakdown |
| `get_monthly_citation_breakdown` | report plumbing/migrations | citation breakdown capability |
| `replace_document_citations_atomic` | editor/research entities | canonical replacement of document citations |
| `replace_document_tags_atomic` | editor/research entities | canonical replacement of document tags |
| `replace_note_tag_links_atomic` | note APIs | canonical replacement of note tags |
| `replace_note_sources_atomic` | note APIs | canonical replacement of note sources |
| `replace_note_links_atomic` | note APIs | canonical replacement of note links |

### Redis key families

| Key pattern | Purpose |
|---|---|
| `user_meta:{user_id}` | cached user metadata for middleware |
| `rate_limit:{ip}` | guest web per-minute rate limit |
| `rate_limit:user:{user_id}` | authenticated per-minute rate limit |
| `user_usage:{user_id}:{date}` | dashboard free daily usage display |
| `user_usage_week:{user_id}:{week}` | web unlock usage and dashboard weekly display |
| `handoff:{user_id}` | auth handoff rate limiting |
| `extension_usage_week:anonymous:{anon_id}:{week}` | guest extension unlock permit usage |
| `extension_usage_day:{user_id}:{date}` | tier-based extension unlock permit usage |
| `extension_usage_week:{user_id}:{week}` | free extension unlock permit usage |
| `extension_anon_pair_rate:{ip_hash}:{anon_id}:{minute}` | guest extension pair rate limit |
| `extension_anon_binding:{ip_hash}:{week}` | binds anon extension ID to IP for week |
| `ext_unlocks:{user_id}:{week}` | extension selection-to-editor document creation counter |
| `extension_usage_event_rate:{user_id}:{minute}` | extension usage-event write throttle |

### Extension local storage / IndexedDB

| Key / store | Purpose |
|---|---|
| `session` | extension auth session |
| `usage_snapshot` | last unlock-permit response |
| `tier_cache` | local extension heuristic credit cache |
| `notes_state` | local notes/projects/tags state |
| `notes_sync_queue` | pending note CRUD sync operations |
| `background_sync_queue` | pending citation and usage-event sync operations |
| `anon_usage_id` | anonymous extension identity for guest permit checks |
| `popup_active_tab` | popup/sidepanel tab persistence |
| `sidepanel_collapsed` | sidepanel state |
| `research_last_selection` | last captured selection |
| IndexedDB `writior_research_state.notes` | locally cached research notes |
| IndexedDB `writior_research_state.citations` | locally cached research citations |

### Storage truth summary

Current product capability is spread across three persistence classes:

- canonical backend entities in Supabase
- short-lived rate limits and cached counters in Redis
- local-first extension state in `chrome.storage.local` and IndexedDB

That split is not accidental. It is part of the current product ability set, especially for extension note/citation capture and handoff behavior.
