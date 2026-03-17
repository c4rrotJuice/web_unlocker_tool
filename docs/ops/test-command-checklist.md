# Test Command Checklist

## Full suite

```bash
pytest -q
```

## Focused release gates

```bash
pytest -q \
  tests/test_auth_core.py \
  tests/test_identity_account_phase2.py \
  tests/test_entitlements.py \
  tests/test_cors.py \
  tests/test_security_headers.py \
  tests/test_request_id_logging.py \
  tests/test_environment_config.py \
  tests/test_payments_webhook.py \
  tests/test_phase6_activity_insights.py \
  tests/test_extension_phase5_contracts.py \
  tests/test_extension_phase9_validation.py \
  tests/test_editor_runtime_architecture.py \
  tests/test_citation_metadata_first_architecture.py \
  tests/test_canonical_enforcement_cleanup.py
```

## Canonical cleanup checks

```bash
pytest -q tests/test_canonical_enforcement_cleanup.py
rg -n "web-unlocker-tool|WEB_UNLOCKER_|user_meta|unlock_history|ip_usage|wu_access_token" app extension tests
```

## Extension profile build

```bash
python3 extension/scripts/build_profile.py --profile staging
python3 extension/scripts/build_profile.py --profile prod
```

## Optional targeted sanity

```bash
pytest -q tests/test_phase7_frontend_shell.py tests/test_research_phase3_services.py tests/test_phase4_workflow_services.py
```
