# Route Surface Audit (App Origin Root Correction)

## Scope
- Canonical app-origin root behavior (`GET /`) in `app/routes/shell.py`
- Legacy V1 unlock home template wiring
- Route continuity for `/auth`, `/dashboard`, `/editor`, `/pricing`, `/auth/handoff`

## Findings
- Cause of stale behavior: `GET /` was rendering `app/templates/home.html`, a legacy V1 unlock-entry page.
- `home.html` still contained direct runtime references to `/view` and `/fetch_and_clean_page`.
- Root therefore exposed stale unlock UX and legacy assumptions instead of v2 app-shell entry.

## Corrections
- Rewired `GET /` to render new v2 shell landing template: `app/templates/app_home.html`.
- Removed legacy template file: `app/templates/home.html`.
- Updated stale CTA/navigation labels and links tied to legacy unlock naming:
  - `app/static/pricing.html`: `/pricing.html` -> `/pricing`, `/unlock` -> `/`
  - `app/templates/auth.html`: "Unlock a Page" -> "Open App"
- Added regression coverage to keep `/` on shell boot metadata and deny `/view` + `/fetch_and_clean_page` references in the root surface.

## Redirect/Compatibility Notes
- No compatibility redirect was added for root; canonical app root now serves the v2 shell landing directly.
- `/pricing` remains an explicit redirect route to `/static/pricing.html`.
- `/auth/handoff` remains explicitly owned by extension routes and is unchanged.
- No `/view` or `/fetch_and_clean_page` route is mounted in active backend routing.
