import pytest

from app.config import environment


def test_resolve_environment_defaults_to_dev(monkeypatch):
    monkeypatch.delenv("ENV", raising=False)
    assert environment.resolve_environment() == "dev"


def test_invalid_environment_fails_fast(monkeypatch):
    monkeypatch.setenv("ENV", "qa")
    with pytest.raises(RuntimeError, match="Invalid ENV"):
        environment.resolve_environment()


def test_validate_environment_requires_staging_vars(monkeypatch):
    monkeypatch.setenv("ENV", "staging")
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.delenv("WEB_UNLOCKER_SUPABASE_URL", raising=False)
    monkeypatch.delenv("WEB_UNLOCKER_SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    with pytest.raises(RuntimeError, match="WEB_UNLOCKER_SUPABASE_URL"):
        environment.validate_environment()


def test_validate_environment_requires_prod_webhook_secret(monkeypatch):
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("WEB_UNLOCKER_SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("CORS_ORIGINS", "https://example.com")
    monkeypatch.delenv("PADDLE_WEBHOOK_SECRET", raising=False)

    with pytest.raises(RuntimeError, match="PADDLE_WEBHOOK_SECRET"):
        environment.validate_environment()
