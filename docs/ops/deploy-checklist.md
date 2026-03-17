# Deploy Checklist

Use these documents together:

- `docs/ops/release-readiness-checklist.md`
- `docs/ops/environment-checklist.md`
- `docs/ops/migration-apply-checklist.md`
- `docs/ops/test-command-checklist.md`
- `docs/ops/known-limitations.md`

## Deployment steps

- [ ] Set `ENV` correctly.
- [ ] Validate required environment variables for that environment.
- [ ] Apply required SQL migrations.
- [ ] Run the focused release-gate tests.
- [ ] Run `pytest -q`.
- [ ] Build the extension profiles used by the target environment.
- [ ] Verify the release-readiness matrix before traffic cutover.

## Extension build

```bash
python3 extension/scripts/build_profile.py --profile staging
python3 extension/scripts/build_profile.py --profile prod
```
