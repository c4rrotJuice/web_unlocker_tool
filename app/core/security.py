from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
import uuid
from dataclasses import dataclass
from enum import Enum

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import Settings, get_settings
from app.core.errors import RateLimitExceededError, UnsafeRedirectError
from app.logging_utils import clear_request_context, configure_logging, set_request_context


logger = logging.getLogger(__name__)
SESSION_COOKIE_NAME = "writior_session"


class RouteAccess(str, Enum):
    PUBLIC = "public"
    AUTH_REQUIRED = "auth_required"
    CAPABILITY_GATED = "capability_gated"


@dataclass(frozen=True)
class RateLimitPolicy:
    name: str
    limit: int
    window_seconds: int


class RouteClassifier:
    def __init__(self) -> None:
        self._exact_rules = {
            "/healthz": RouteAccess.PUBLIC,
            "/status": RouteAccess.PUBLIC,
            "/api/public-config": RouteAccess.PUBLIC,
            "/api/auth/signup": RouteAccess.PUBLIC,
            "/api/auth/session": RouteAccess.PUBLIC,
            "/api/identity/status": RouteAccess.PUBLIC,
            "/api/billing/status": RouteAccess.PUBLIC,
            "/api/unlock/status": RouteAccess.PUBLIC,
            "/api/research/status": RouteAccess.PUBLIC,
            "/api/workspace/status": RouteAccess.PUBLIC,
            "/api/extension/status": RouteAccess.PUBLIC,
            "/api/insights/status": RouteAccess.PUBLIC,
            "/": RouteAccess.PUBLIC,
            "/auth": RouteAccess.PUBLIC,
            "/pricing": RouteAccess.PUBLIC,
            "/pricing/success": RouteAccess.PUBLIC,
            "/auth/handoff": RouteAccess.PUBLIC,
            "/dashboard": RouteAccess.AUTH_REQUIRED,
            "/projects": RouteAccess.AUTH_REQUIRED,
            "/research": RouteAccess.AUTH_REQUIRED,
            "/editor": RouteAccess.AUTH_REQUIRED,
            "/insights": RouteAccess.AUTH_REQUIRED,
            "/api/me": RouteAccess.AUTH_REQUIRED,
            "/api/profile": RouteAccess.AUTH_REQUIRED,
            "/api/preferences": RouteAccess.AUTH_REQUIRED,
            "/api/entitlements/current": RouteAccess.AUTH_REQUIRED,
            "/api/billing/customer": RouteAccess.AUTH_REQUIRED,
            "/api/billing/subscription": RouteAccess.AUTH_REQUIRED,
            "/api/identity/me": RouteAccess.AUTH_REQUIRED,
            "/api/identity/account": RouteAccess.AUTH_REQUIRED,
            "/api/identity/capabilities": RouteAccess.AUTH_REQUIRED,
        }
        self._prefix_rules = (
            ("/projects/", RouteAccess.AUTH_REQUIRED),
            ("/api/projects", RouteAccess.AUTH_REQUIRED),
            ("/api/tags", RouteAccess.AUTH_REQUIRED),
            ("/api/sources", RouteAccess.AUTH_REQUIRED),
            ("/api/citations", RouteAccess.AUTH_REQUIRED),
            ("/api/quotes", RouteAccess.AUTH_REQUIRED),
            ("/api/notes", RouteAccess.AUTH_REQUIRED),
            ("/api/research/", RouteAccess.AUTH_REQUIRED),
            ("/api/citation-templates", RouteAccess.AUTH_REQUIRED),
            ("/api/docs", RouteAccess.AUTH_REQUIRED),
            ("/api/editor/access", RouteAccess.AUTH_REQUIRED),
            ("/api/activity", RouteAccess.AUTH_REQUIRED),
            ("/api/extension/", RouteAccess.AUTH_REQUIRED),
        )

    def classify(self, path: str) -> RouteAccess:
        if path in self._exact_rules:
            return self._exact_rules[path]
        for prefix, access in self._prefix_rules:
            if path.startswith(prefix):
                return access
        return RouteAccess.PUBLIC


def get_route_classifier() -> RouteClassifier:
    return RouteClassifier()


def classify_route(path: str) -> str:
    return get_route_classifier().classify(path).value


def validate_internal_redirect_path(path: str | None) -> str:
    candidate = (path or "").strip()
    if not candidate:
        return "/dashboard"
    if not candidate.startswith("/"):
        raise UnsafeRedirectError()
    if candidate.startswith("//"):
        raise UnsafeRedirectError()
    if "\\" in candidate:
        raise UnsafeRedirectError()
    if any(ord(char) < 32 for char in candidate):
        raise UnsafeRedirectError()
    if "://" in candidate:
        raise UnsafeRedirectError()
    return candidate


def is_safe_redirect(path: str | None) -> bool:
    try:
        validate_internal_redirect_path(path)
        return True
    except UnsafeRedirectError:
        return False


def set_session_cookie(response, token: str, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.env not in {"dev", "test"},
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.env not in {"dev", "test"},
        samesite="lax",
        path="/",
    )


def resolve_client_ip(request: Request, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    client_host = request.client.host if request.client else "unknown"
    if not settings.allow_proxy_headers:
        return client_host
    try:
        client_ip = ipaddress.ip_address(client_host)
    except ValueError:
        return client_host
    if not any(client_ip in network for network in settings.trusted_proxy_nets):
        return client_host
    forwarded = request.headers.get("x-forwarded-for", "")
    if not forwarded:
        return client_host
    first = forwarded.split(",")[0].strip()
    return first or client_host


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, tuple[int, float]] = {}
        self._lock: asyncio.Lock | None = None

    async def hit(self, key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.time()
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            count, reset_at = self._buckets.get(key, (0, now + window_seconds))
            if now >= reset_at:
                count = 0
                reset_at = now + window_seconds
            count += 1
            self._buckets[key] = (count, reset_at)
            remaining = max(limit - count, 0)
            retry_after = max(int(reset_at - now), 0)
            return count <= limit, retry_after if count > limit else remaining


def get_rate_limit_policies(settings: Settings | None = None) -> dict[str, RateLimitPolicy]:
    settings = settings or get_settings()
    return {
        "anonymous_public": RateLimitPolicy(
            name="anonymous_public",
            limit=settings.rate_limits.anonymous_public_limit,
            window_seconds=settings.rate_limits.anonymous_public_window_seconds,
        ),
        "authenticated_read": RateLimitPolicy(
            name="authenticated_read",
            limit=settings.rate_limits.authenticated_read_limit,
            window_seconds=settings.rate_limits.authenticated_read_window_seconds,
        ),
        "auth_sensitive": RateLimitPolicy(
            name="auth_sensitive",
            limit=settings.rate_limits.auth_sensitive_limit,
            window_seconds=settings.rate_limits.auth_sensitive_window_seconds,
        ),
        "future_write_heavy": RateLimitPolicy(
            name="future_write_heavy",
            limit=settings.rate_limits.future_write_heavy_limit,
            window_seconds=settings.rate_limits.future_write_heavy_window_seconds,
        ),
    }


def rate_limit_key_for_request(request: Request, policy_name: str) -> str:
    auth_context = getattr(request.state, "auth_context", None)
    route_classifier = getattr(request.app.state, "route_classifier", get_route_classifier())
    route_access = route_classifier.classify(request.url.path)
    if auth_context is not None and getattr(auth_context, "user_id", None):
        identity = f"user:{auth_context.user_id}"
    else:
        identity = f"ip:{resolve_client_ip(request)}"
    return f"{policy_name}:{route_access.value}:{identity}"


def derive_rate_limit_key(auth_context, request: Request | None = None, *, policy_name: str = "authenticated_read") -> str:
    if auth_context is not None and getattr(auth_context, "user_id", None):
        return f"{policy_name}:auth_required:user:{auth_context.user_id}"
    if request is None:
        return f"{policy_name}:public:ip:unknown"
    return f"{policy_name}:public:ip:{resolve_client_ip(request)}"


def get_rate_limiter(request: Request) -> InMemoryRateLimiter:
    return request.app.state.rate_limiter


def enforce_rate_limit(policy_name: str):
    async def _dependency(request: Request, limiter: InMemoryRateLimiter = Depends(get_rate_limiter)) -> None:
        policies = request.app.state.rate_limit_policies
        policy = policies[policy_name]
        key = rate_limit_key_for_request(request, policy_name)
        allowed, aux = await limiter.hit(key, limit=policy.limit, window_seconds=policy.window_seconds)
        if not allowed:
            raise RateLimitExceededError(retry_after_seconds=aux)
    return _dependency


def install_cors(app: FastAPI, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id", "X-User-Timezone"],
        expose_headers=["X-Request-Id"],
    )


def install_security_middleware(app: FastAPI, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    configure_logging()

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())
        request.state.request_id = request_id
        request.state.route_access = app.state.route_classifier.classify(request.url.path)
        set_request_context(request_id=request_id, route=request.url.path)
        start = time.perf_counter()
        try:
            response = await call_next(request)
            latency_ms = round((time.perf_counter() - start) * 1000, 2)
            request.state.response_status = response.status_code
            set_request_context(status=response.status_code, latency_ms=latency_ms)
            logger.info("request.completed", extra={"status": response.status_code, "latency_ms": latency_ms})
            response.headers["X-Request-Id"] = request_id
            return response
        finally:
            clear_request_context()

    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next):
        response = await call_next(request)
        if settings.security_hsts_enabled:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response


def initialize_security(app: FastAPI, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    app.state.route_classifier = get_route_classifier()
    app.state.rate_limit_policies = get_rate_limit_policies(settings)
    if not hasattr(app.state, "rate_limiter"):
        app.state.rate_limiter = InMemoryRateLimiter()
    install_cors(app, settings)
    install_security_middleware(app, settings)
