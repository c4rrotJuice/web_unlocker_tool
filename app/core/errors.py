from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


@dataclass
class AppError(Exception):
    code: str
    message: str
    status_code: int
    extra: dict[str, object] = field(default_factory=dict)


class MissingCredentialsError(AppError):
    def __init__(self, message: str = "Missing bearer token.") -> None:
        super().__init__("missing_credentials", message, 401)


class MalformedCredentialsError(AppError):
    def __init__(self, message: str = "Malformed bearer token.") -> None:
        super().__init__("malformed_credentials", message, 401)


class InvalidTokenError(AppError):
    def __init__(self, message: str = "Invalid bearer token.") -> None:
        super().__init__("invalid_token", message, 401)


class ExpiredTokenError(AppError):
    def __init__(self, message: str = "Expired bearer token.") -> None:
        super().__init__("expired_token", message, 401)


class AccountNotFoundError(AppError):
    def __init__(self, message: str = "Canonical account state not found.") -> None:
        super().__init__("account_not_found", message, 404)


class EntitlementInactiveError(AppError):
    def __init__(self, message: str = "Entitlement is not active.") -> None:
        super().__init__("entitlement_inactive", message, 403)


class CapabilityForbiddenError(AppError):
    def __init__(self, message: str = "Capability is not permitted.") -> None:
        super().__init__("capability_forbidden", message, 403)


class UnsafeRedirectError(AppError):
    def __init__(self, message: str = "Unsafe redirect path.") -> None:
        super().__init__("unsafe_redirect", message, 400)


class RateLimitExceededError(AppError):
    def __init__(self, message: str = "Rate limit exceeded.", *, retry_after_seconds: int | None = None) -> None:
        extra: dict[str, object] = {}
        if retry_after_seconds is not None:
            extra["retry_after_seconds"] = retry_after_seconds
        super().__init__("rate_limit_exceeded", message, 429, extra=extra)


def error_payload(error: AppError, *, request_id: str | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "error": {
            "code": error.code,
            "message": error.message,
        }
    }
    if request_id:
        payload["request_id"] = request_id
    if error.extra:
        payload["error"]["details"] = error.extra
    return payload


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    response = JSONResponse(status_code=exc.status_code, content=error_payload(exc, request_id=request_id))
    if request_id:
        response.headers["X-Request-Id"] = request_id
    if isinstance(exc, RateLimitExceededError):
        retry_after = exc.extra.get("retry_after_seconds")
        if retry_after is not None:
            response.headers["Retry-After"] = str(retry_after)
    return response


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
