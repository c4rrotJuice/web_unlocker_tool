from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.core.account_state import AccountStateService
from app.core.errors import AccountNotFoundError
from app.core.security import (
    RouteAccess,
    classify_route,
    derive_rate_limit_key,
    get_route_classifier,
    is_safe_redirect,
    rate_limit_key_for_request,
    validate_internal_redirect_path,
)
from app.logging_utils import log_auth_event, redact_value


class MissingRowsRepository:
    async def fetch_profile(self, user_id: str):
        return {"display_name": "Fallback User", "use_case": None}

    async def fetch_preferences(self, user_id: str):
        return None

    async def fetch_entitlement(self, user_id: str):
        return {"tier": "free", "status": "active", "source": "system", "auto_renew": False}

    async def fetch_billing_customer(self, user_id: str):
        return None

    async def fetch_billing_subscription(self, user_id: str):
        return None


class MissingRequiredRowsRepository(MissingRowsRepository):
    async def fetch_profile(self, user_id: str):
        return None


@pytest.mark.anyio
async def test_missing_any_required_canonical_row_fails_cleanly():
    service = AccountStateService(MissingRowsRepository())
    with pytest.raises(AccountNotFoundError):
        await service.load("user-1")


@pytest.mark.anyio
async def test_missing_required_rows_fail_cleanly():
    service = AccountStateService(MissingRequiredRowsRepository())
    with pytest.raises(AccountNotFoundError):
        await service.load("user-1")


def test_route_classifier_is_authoritative_for_mounted_v2_routes():
    classifier = get_route_classifier()

    assert classifier.classify("/api/public-config") == RouteAccess.PUBLIC
    assert classifier.classify("/api/me") == RouteAccess.AUTH_REQUIRED
    assert classifier.classify("/api/unknown") == RouteAccess.PUBLIC


def test_redirect_validation_rejects_unsafe_targets_and_normalizes_empty():
    assert validate_internal_redirect_path(None) == "/dashboard"
    assert validate_internal_redirect_path("/editor?doc=abc") == "/editor?doc=abc"

    for value in ("https://evil.example.com", "//evil.example.com", "\\evil", "javascript:alert(1)", "/bad\npath"):
        with pytest.raises(Exception):
            validate_internal_redirect_path(value)


def test_redirect_predicates_cover_protocol_relative_full_url_backslash_and_valid_path():
    assert is_safe_redirect("//evil.com") is False
    assert is_safe_redirect("https://evil.com") is False
    assert is_safe_redirect("\\evil.com") is False
    assert is_safe_redirect("/editor") is True


def test_rate_limit_key_derivation_prefers_verified_user_and_else_ip():
    base_scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/me",
        "headers": [],
        "query_string": b"",
        "client": ("10.0.0.1", 1234),
        "server": ("testserver", 80),
        "scheme": "http",
        "app": SimpleNamespace(state=SimpleNamespace(route_classifier=get_route_classifier())),
    }
    request = Request(dict(base_scope))
    request.state.auth_context = SimpleNamespace(user_id="user-1")

    assert rate_limit_key_for_request(request, "authenticated_read") == "authenticated_read:auth_required:user:user-1"

    request_no_auth = Request(dict(base_scope))
    assert rate_limit_key_for_request(request_no_auth, "anonymous_public") == "anonymous_public:auth_required:ip:10.0.0.1"


def test_rate_limit_key_helpers_cover_authenticated_and_anonymous():
    auth_context = SimpleNamespace(user_id="user-1")
    assert "user-1" in derive_rate_limit_key(auth_context)

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/status",
        "headers": [],
        "query_string": b"",
        "client": ("10.0.0.2", 1234),
        "server": ("testserver", 80),
        "scheme": "http",
        "app": SimpleNamespace(state=SimpleNamespace(route_classifier=get_route_classifier())),
    }
    request = Request(scope)
    assert "10.0.0.2" in derive_rate_limit_key(None, request, policy_name="anonymous_public")


def test_logging_redaction_removes_tokens_and_secrets():
    payload = {
        "authorization": "Bearer secret-token",
        "refresh_token": "refresh-123",
        "api_key": "key-123",
        "handoff_code": "code-123",
        "message": "token=abc secret=def code=ghi",
    }
    redacted = redact_value(payload)

    assert redacted["authorization"] == "[REDACTED]"
    assert redacted["refresh_token"] == "[REDACTED]"
    assert redacted["api_key"] == "[REDACTED]"
    assert redacted["handoff_code"] == "[REDACTED]"
    assert "[REDACTED]" in redacted["message"]


def test_auth_logging_redacts_tokens(caplog):
    caplog.set_level("INFO")
    log_auth_event(token="Bearer abc.def.ghi", refresh_token="refresh123")

    assert caplog.records
    for record in caplog.records:
        assert "abc.def.ghi" not in record.message
        assert "refresh123" not in record.message


def test_route_classifier_identity_endpoint():
    assert classify_route("/api/me") == "auth_required"


def test_route_classifier_public_status():
    assert classify_route("/status") == "public"
