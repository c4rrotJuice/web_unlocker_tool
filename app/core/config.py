from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _parse_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _parse_int_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    return int(raw)


@dataclass(frozen=True)
class RateLimitSettings:
    anonymous_public_limit: int
    anonymous_public_window_seconds: int
    authenticated_read_limit: int
    authenticated_read_window_seconds: int
    auth_sensitive_limit: int
    auth_sensitive_window_seconds: int
    future_write_heavy_limit: int
    future_write_heavy_window_seconds: int


@dataclass(frozen=True)
class Settings:
    env: str
    supabase_url: str | None
    supabase_anon_key: str | None
    supabase_service_role_key: str | None
    paddle_webhook_secret: str | None
    migration_pack_dir: Path
    schema_contract_source: str
    enable_docs: bool
    canonical_app_origin: str
    cors_origins: tuple[str, ...]
    trusted_proxy_cidrs: tuple[str, ...]
    trusted_proxy_nets: tuple[ipaddress._BaseNetwork, ...]
    allow_proxy_headers: bool
    security_hsts_enabled: bool
    auth_handoff_ttl_seconds: int
    extension_idempotency_ttl_seconds: int
    rate_limits: RateLimitSettings


def _validate_settings(settings: Settings) -> Settings:
    if settings.env not in {"dev", "test", "staging", "prod"}:
        raise RuntimeError("ENV must be one of dev, test, staging, prod.")
    if settings.env in {"staging", "prod"}:
        if not settings.cors_origins:
            raise RuntimeError("CORS_ORIGINS must be configured in staging/prod.")
        if any(origin == "*" for origin in settings.cors_origins):
            raise RuntimeError("CORS_ORIGINS cannot contain '*'.")
    if settings.env == "prod" and not settings.paddle_webhook_secret:
        raise RuntimeError("PADDLE_WEBHOOK_SECRET must be configured in prod.")
    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    repo_root = _repo_root()
    migration_pack_dir = repo_root / "writior_migration_pack"
    trusted_proxy_cidrs = _parse_csv(os.getenv("TRUSTED_PROXY_CIDRS"))
    trusted_proxy_nets = tuple(ipaddress.ip_network(value, strict=False) for value in trusted_proxy_cidrs)
    settings = Settings(
        env=(os.getenv("ENV") or "dev").strip().lower(),
        supabase_url=(os.getenv("SUPABASE_URL") or "").strip() or None,
        supabase_anon_key=((os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY") or "").strip() or None),
        supabase_service_role_key=(os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip() or None,
        paddle_webhook_secret=(os.getenv("PADDLE_WEBHOOK_SECRET") or "").strip() or None,
        migration_pack_dir=migration_pack_dir,
        schema_contract_source=str(migration_pack_dir),
        enable_docs=(os.getenv("ENABLE_DOCS") or "true").strip().lower() in {"1", "true", "yes"},
        canonical_app_origin=(os.getenv("CANONICAL_APP_ORIGIN") or "https://app.writior.com").strip(),
        cors_origins=_parse_csv(os.getenv("CORS_ORIGINS")) or ((os.getenv("CANONICAL_APP_ORIGIN") or "https://app.writior.com").strip(),),
        trusted_proxy_cidrs=trusted_proxy_cidrs,
        trusted_proxy_nets=trusted_proxy_nets,
        allow_proxy_headers=(os.getenv("ALLOW_PROXY_HEADERS") or "false").strip().lower() in {"1", "true", "yes"},
        security_hsts_enabled=(os.getenv("SECURITY_HSTS_ENABLED") or "true").strip().lower() in {"1", "true", "yes"},
        auth_handoff_ttl_seconds=_parse_int_env("AUTH_HANDOFF_TTL_SECONDS", 60),
        extension_idempotency_ttl_seconds=_parse_int_env("EXTENSION_IDEMPOTENCY_TTL_SECONDS", 900),
        rate_limits=RateLimitSettings(
            anonymous_public_limit=_parse_int_env("RATE_LIMIT_ANONYMOUS_PUBLIC", 60),
            anonymous_public_window_seconds=_parse_int_env("RATE_LIMIT_ANONYMOUS_PUBLIC_WINDOW_SECONDS", 60),
            authenticated_read_limit=_parse_int_env("RATE_LIMIT_AUTHENTICATED_READ", 120),
            authenticated_read_window_seconds=_parse_int_env("RATE_LIMIT_AUTHENTICATED_READ_WINDOW_SECONDS", 60),
            auth_sensitive_limit=_parse_int_env("RATE_LIMIT_AUTH_SENSITIVE", 20),
            auth_sensitive_window_seconds=_parse_int_env("RATE_LIMIT_AUTH_SENSITIVE_WINDOW_SECONDS", 60),
            future_write_heavy_limit=_parse_int_env("RATE_LIMIT_FUTURE_WRITE_HEAVY", 30),
            future_write_heavy_window_seconds=_parse_int_env("RATE_LIMIT_FUTURE_WRITE_HEAVY_WINDOW_SECONDS", 60),
        ),
    )
    return _validate_settings(settings)
