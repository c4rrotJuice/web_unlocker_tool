from __future__ import annotations

from dataclasses import dataclass, field
import logging

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_utils import redact_value


logger = logging.getLogger(__name__)


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


class AccountBootstrapFailedError(AppError):
    def __init__(self, message: str = "Canonical account bootstrap failed.") -> None:
        super().__init__("account_bootstrap_failed", message, 500)


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


def unwrap_app_error(exc: Exception) -> AppError | None:
    if isinstance(exc, AppError):
        return exc
    nested = getattr(exc, "exceptions", None)
    if not nested:
        return None
    for child in nested:
        unwrapped = unwrap_app_error(child)
        if unwrapped is not None:
            return unwrapped
    return None


_EXTENSION_ERROR_PREFIXES = (
    "/api/extension",
    "/api/auth/handoff",
)


def is_extension_api_path(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in _EXTENSION_ERROR_PREFIXES)


def normalize_error_details(details: object | None) -> object | None:
    if details is None:
        return None
    return redact_value(details)


def extension_error_payload(
    *,
    code: str,
    message: str,
    request_id: str | None = None,
    details: object | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "ok": False,
        "data": None,
        "error": {
            "code": code,
            "message": redact_value(message),
        },
        "meta": {},
    }
    normalized_details = normalize_error_details(details)
    if normalized_details is not None:
        payload["error"]["details"] = normalized_details
    if request_id:
        payload["meta"] = {"request_id": request_id}
    return payload


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
    if is_extension_api_path(request.url.path):
        response = JSONResponse(
            status_code=exc.status_code,
            content=extension_error_payload(
                code=exc.code,
                message=exc.message,
                request_id=request_id,
                details=exc.extra or None,
            ),
        )
    else:
        response = JSONResponse(status_code=exc.status_code, content=error_payload(exc, request_id=request_id))
    if request_id:
        response.headers["X-Request-Id"] = request_id
    if isinstance(exc, RateLimitExceededError):
        retry_after = exc.extra.get("retry_after_seconds")
        if retry_after is not None:
            response.headers["Retry-After"] = str(retry_after)
    return response


async def extension_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if not is_extension_api_path(request.url.path):
        return await http_exception_handler(request, exc)
    request_id = getattr(request.state, "request_id", None)
    detail = exc.detail
    if isinstance(detail, dict):
        code = str(detail.get("code") or f"http_{exc.status_code}")
        message = str(detail.get("message") or "Request failed.")
        details = detail.get("details")
    else:
        code = f"http_{exc.status_code}"
        message = str(detail or "Request failed.")
        details = None
    response = JSONResponse(
        status_code=exc.status_code,
        content=extension_error_payload(
            code=code,
            message=message,
            request_id=request_id,
            details=details,
        ),
    )
    if request_id:
        response.headers["X-Request-Id"] = request_id
    if exc.status_code == 429:
        retry_after = getattr(exc, "headers", {}).get("Retry-After") if getattr(exc, "headers", None) else None
        if retry_after:
            response.headers["Retry-After"] = retry_after
    return response


async def extension_validation_exception_handler(request: Request, exc: RequestValidationError):
    if not is_extension_api_path(request.url.path):
        return await request_validation_exception_handler(request, exc)
    request_id = getattr(request.state, "request_id", None)
    response = JSONResponse(
        status_code=422,
        content=extension_error_payload(
            code="validation_error",
            message="Request validation failed.",
            request_id=request_id,
            details={"issues": exc.errors()},
        ),
    )
    if request_id:
        response.headers["X-Request-Id"] = request_id
    return response


async def extension_unhandled_exception_handler(request: Request, exc: Exception):
    app_error = unwrap_app_error(exc)
    if app_error is not None:
        return await app_error_handler(request, app_error)
    if not is_extension_api_path(request.url.path):
        raise exc
    request_id = getattr(request.state, "request_id", None)
    logger.exception("extension.unhandled_exception", extra={"error": redact_value(str(exc))})
    response = JSONResponse(
        status_code=500,
        content=extension_error_payload(
            code="internal_error",
            message="Internal server error.",
            request_id=request_id,
        ),
    )
    if request_id:
        response.headers["X-Request-Id"] = request_id
    return response


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(StarletteHTTPException, extension_http_exception_handler)
    app.add_exception_handler(RequestValidationError, extension_validation_exception_handler)
    app.add_exception_handler(Exception, extension_unhandled_exception_handler)
