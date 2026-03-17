# Writior v2

Writior v2 is a canonical rebuild of the product as an extension-first research-to-writing platform on the fresh v2 schema.

The active runtime is contract-only:

- bearer-token API auth verified server-side
- one-time extension to web auth handoff
- canonical research graph: `sources -> citations -> quotes -> notes -> documents`
- canonical activity and reporting tables
- modular editor runtime under `app/static/js/editor_v2`
- modular extension runtime under `extension/`

No legacy compatibility layer is part of the supported runtime.

## Active surfaces

- Web shell: `/`, `/auth`, `/dashboard`, `/projects`, `/research`, `/editor`, `/insights`
- Identity: `/api/auth/signup`, `/api/identity/*`, `/api/entitlements/current`
- Billing: `/api/billing/*`, `/api/webhooks/paddle`
- Activity: `/api/activity/events`, `/api/activity/unlocks`, `/api/activity/bookmarks`, `/api/activity/milestones`
- Research: `/api/sources*`, `/api/citations*`, `/api/quotes*`, `/api/notes*`, `/api/projects*`, `/api/tags*`
- Workspace: `/api/documents*`, checkpoints, bibliography, canonical relation replacement
- Extension: `/api/auth/handoff`, `/api/auth/handoff/exchange`, `/api/extension/work-in-editor`, `/api/extension/usage-events`
- Insights/reporting: `/api/insights/*`, `/api/reports/monthly`

## Repository layout

```text
app/
  core/
  modules/
  routes/shell.py
  static/js/app_shell/
  static/js/editor_v2/
  templates/
extension/
sql/
tests/
docs/ops/
```

## Local run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r app/requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Test entrypoint

```bash
pytest -q
```

## Authoritative ops docs

- [Release readiness](docs/ops/release-readiness-checklist.md)
- [Environment checklist](docs/ops/environment-checklist.md)
- [Migration apply checklist](docs/ops/migration-apply-checklist.md)
- [Test command checklist](docs/ops/test-command-checklist.md)
- [Known limitations](docs/ops/known-limitations.md)
- [Deploy checklist](docs/ops/deploy-checklist.md)

## Historical docs

Older phase reports and audits remain in `docs/` as historical records only. Do not use them as implementation or deployment guidance.
