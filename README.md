# Web Unlocker Tool

Web Unlocker Tool is a FastAPI-based web application (plus companion browser extension) for opening paywall/anti-bot protected pages in a cleaned reader view, collecting citations, and managing a research workflow (history, bookmarks, and an integrated editor).

## What this project includes

- **Web app** (`app/`): unlock + clean remote pages, account-aware limits, dashboard/reporting, citations, bookmarks, rich-text editor, subscription-aware feature gating.
- **Browser extension** (`extension/`): invokes unlock actions from the browser, sends selection/usage events, and supports secure auth handoff into the web editor.
- **SQL migrations** (`sql/`): schema updates for editor checkpoints, auth handoff codes, payment/subscription tracking, and extension usage events.
- **Tests** (`tests/`): API and service tests for auth handoff, editor auth flow, extension permits/events, payments webhooks, reports, and entitlements.

## Core features

### 1) Unlock + clean page rendering

- `GET/POST /view` and `POST /fetch_and_clean_page` fetch target pages and return sanitized HTML for rendering in an iframe.
- Supports account-tier aware behavior (e.g., Cloudscraper for paid tiers, fallback handling for guests/free users).
- Uses shared async HTTP client and queue priority controls.

### 2) Authentication + account context

- Supabase-backed token validation in middleware.
- Supports bearer-token auth and cookie fallback (`wu_access_token`) for web app sessions.
- Caches user metadata (`account_type`, daily limit, etc.) in Upstash Redis.

### 3) Extension ↔ web app auth handoff

- `POST /api/auth/handoff` creates a one-time, short-lived handoff code.
- `POST /api/auth/handoff/exchange` redeems the code, returns session tokens, and marks code as used.
- Designed to avoid putting long-lived tokens in URLs.

### 4) Extension APIs

- `POST /api/extension/unlock-permit`: checks whether a user can unlock.
- `POST /api/extension/selection`: records captured selection details.
- `POST /api/extension/usage-event`: writes idempotent unlock usage events into shared history stream.

### 5) Research workflow APIs

- **Citations**: create/list citations and bulk fetch by ID.
- **Bookmarks**: create/list/delete bookmarks.
- **History**: list unlock history and query/search history (paid tiers).
- **Editor**: documents CRUD, checkpoints/history restore, export payload generation.

### 6) Dashboard + reporting + billing

- User info endpoint and momentum/dashboard metrics.
- Monthly PDF report generation endpoint.
- Paddle checkout helpers and webhook ingestion for subscription state sync.

## Tech stack

- **Backend:** FastAPI, httpx, Supabase Python SDK
- **Data/cache:** Supabase Postgres + Upstash Redis (REST API)
- **Content handling:** selectolax/BeautifulSoup/lxml/bleach + optional cloudscraper
- **Reporting:** reportlab (PDF generation)
- **Frontend:** Jinja templates + static JS/CSS + Quill editor
- **Extension:** Manifest V3, vanilla JS

## Repository layout

```text
.
├── app/
│   ├── main.py                # FastAPI app, middleware, router registration
│   ├── routes/                # API routes
│   ├── services/              # Unlocking/auth/entitlement/cache logic
│   ├── templates/             # Jinja templates (home, dashboard, editor, auth)
│   ├── static/                # CSS/JS/assets
│   └── requirements.txt
├── extension/                 # Browser extension source
├── sql/                       # SQL schema/migration files
├── tests/                     # Pytest suite
└── README.md
```

## Prerequisites

- Python 3.11+ (recommended)
- Supabase project (URL, anon key, service role key)
- Upstash Redis REST credentials
- Paddle credentials (if testing billing endpoints)

## Environment variables

Create `.env` in the project root (or otherwise export variables before start):

```bash
# Supabase
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Optional web auth config overrides (defaults to SUPABASE_URL / SUPABASE_KEY)
WEB_UNLOCKER_SUPABASE_URL=
WEB_UNLOCKER_SUPABASE_ANON_KEY=

# Upstash Redis (required for rate limits/cache paths)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Fetch / unlock tuning (optional)
FETCH_CONCURRENCY=5
FETCH_MAX_RETRIES=2
FETCH_TIMEOUT_SECONDS=15
FETCH_CONNECT_TIMEOUT_SECONDS=5
LOW_CONF_BLOCK_RETRY_ENABLED=false
CLOUDSCRAPER_BROWSER=chrome
CLOUDSCRAPER_PLATFORM=windows
CLOUDSCRAPER_MOBILE=false
CLOUDSCRAPER_DELAY=0

# Payments (optional unless using Paddle endpoints)
PADDLE_API=
PADDLE_ENV=sandbox
PADDLE_API_VERSION=1
PADDLE_CLIENT_TOKEN_NAME=client_token
PADDLE_WEBHOOK_SECRET=

# Optional debug
DEBUG_AUTH_HANDOFF=false
DEV_HASH=
```

## Local development

```bash
# 1) Create and activate venv
python -m venv .venv
source .venv/bin/activate

# 2) Install dependencies
pip install -r app/requirements.txt

# 3) Run API server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Open:

- App home: `http://localhost:8000/`
- Auth page: `http://localhost:8000/auth`
- Editor: `http://localhost:8000/editor`

## Running tests

```bash
pytest -q
```

If you only need a focused check while iterating:

```bash
pytest -q tests/test_auth_handoff.py tests/test_extension_usage_event.py
```

## Browser extension setup

See `extension/README.md` for extension configuration details. In short, set backend + Supabase values in `extension/config.js`, then load the unpacked `extension/` folder in Chromium-based browsers.

## API surface (high level)

- Page unlock/render: `/view`, `/fetch_and_clean_page`
- Auth handoff: `/api/auth/handoff`, `/api/auth/handoff/exchange`
- Dashboard/reporting: `/api/me`, `/api/dashboard/momentum`, `/api/reports/monthly`
- Research data: `/api/citations`, `/api/bookmarks`, `/api/unlocks`, `/api/history`
- Editor: `/api/editor/access`, `/api/docs*`
- Extension: `/api/extension/unlock-permit`, `/api/extension/selection`, `/api/extension/usage-event`
- Billing: `/get_paddle_token`, `/create_paddle_checkout`, `/webhooks/paddle`

## Notes

- This service relies on external providers (Supabase, Upstash, Paddle). A fully offline local run is limited unless these dependencies are mocked.
- The unlocking pipeline intentionally uses multiple heuristics and fallback behavior to handle different anti-bot/paywall patterns.
