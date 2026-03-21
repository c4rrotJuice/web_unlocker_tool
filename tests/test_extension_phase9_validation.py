from pathlib import Path


def _read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def test_extension_backend_contract_map_is_owned_by_backend_modules():
    routes = _read("app/modules/extension/routes.py")
    service = _read("app/modules/extension/service.py")
    repo = _read("app/modules/extension/repo.py")
    schemas = _read("app/modules/extension/schemas.py")
    shell = _read("app/routes/shell.py")
    template = _read("app/templates/auth_handoff.html")

    assert "/api/extension/bootstrap" in routes
    assert "/api/auth/handoff" in routes
    assert "/api/auth/handoff/exchange" in routes
    assert "/api/auth/handoff/attempts" in routes
    assert "/api/extension/work-in-editor" in routes
    assert "build_access_context" in service
    assert "capability_state_from_account_state" in service
    assert "issue_handoff" in service
    assert "exchange_handoff" in service
    assert "work_in_editor" in service
    assert "consume_handoff_code" in repo
    assert "invalidate_handoff_code" in repo
    assert "create_handoff_attempt" in repo
    assert "HandoffIssueRequest" in schemas
    assert "HandoffExchangeRequest" in schemas
    assert "WorkInEditorRequest" in schemas
    assert '"seeded": request.query_params.get("seeded") in {"1", "true", "yes"}' in shell
    assert '"source_id": request.query_params.get("seed_source_id") or None' in shell
    assert '"mode": request.query_params.get("seed_mode") or ("seed_review" if request.query_params.get("seeded") in {"1", "true", "yes"} else None)' in shell
    assert "Sign-in complete" in template
    assert "Return to the extension" in template


def test_auth_handoff_template_stays_generic_and_backend_terminated():
    template = _read("app/templates/auth_handoff.html")

    assert "Compatibility seam only." in template
    assert "new extension must use backend auth handoff endpoints directly" in template
    assert "chrome.runtime.sendMessage" in template
    assert "auth.setSession" in template
    assert "web_auth_client_missing" in template
    assert "Retry sign-in" in template
    assert "Missing handoff details" in template
    assert "Waiting for extension bridge timed out" not in template
