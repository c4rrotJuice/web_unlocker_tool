from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase_anon = create_client(SUPABASE_URL, SUPABASE_KEY)

ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"
CSRF_COOKIE_NAME = "csrf_token"

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class AuthenticatedUser:
    id: str
    email: Optional[str] = None


def _cookie_secure(request: Request) -> bool:
    cookie_secure_default = os.getenv("COOKIE_SECURE", "true").lower() != "false"
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    request_is_https = request.url.scheme == "https" or forwarded_proto == "https"
    return cookie_secure_default and request_is_https


def create_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def apply_auth_cookies(
    request: Request,
    response,
    *,
    access_token: str,
    refresh_token: Optional[str],
    access_max_age: int = 3600,
    refresh_max_age: int = 60 * 60 * 24 * 30,
) -> None:
    secure_cookie = _cookie_secure(request)
    response.set_cookie(
        ACCESS_COOKIE_NAME,
        access_token,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=access_max_age,
        path="/",
    )
    if refresh_token:
        response.set_cookie(
            REFRESH_COOKIE_NAME,
            refresh_token,
            httponly=True,
            secure=secure_cookie,
            samesite="lax",
            max_age=refresh_max_age,
            path="/",
        )

    response.set_cookie(
        CSRF_COOKIE_NAME,
        create_csrf_token(),
        httponly=False,
        secure=secure_cookie,
        samesite="lax",
        max_age=refresh_max_age,
        path="/",
    )


def clear_auth_cookies(request: Request, response) -> None:
    secure_cookie = _cookie_secure(request)
    for cookie_name, httponly in (
        (ACCESS_COOKIE_NAME, True),
        (REFRESH_COOKIE_NAME, True),
        (CSRF_COOKIE_NAME, False),
    ):
        response.set_cookie(
            cookie_name,
            "",
            httponly=httponly,
            secure=secure_cookie,
            samesite="lax",
            max_age=0,
            path="/",
        )


def _validate_token(token: str) -> Optional[AuthenticatedUser]:
    try:
        user_res = supabase_anon.auth.get_user(token)
        user = user_res.user
        if user:
            return AuthenticatedUser(id=user.id, email=user.email)
    except Exception:
        return None
    return None


def authenticate_request(request: Request) -> Optional[AuthenticatedUser]:
    cookie_token = request.cookies.get(ACCESS_COOKIE_NAME)
    auth_header = request.headers.get("authorization") or ""

    cookie_user = _validate_token(cookie_token) if cookie_token else None

    header_user = None
    if auth_header.lower().startswith("bearer "):
        header_token = auth_header.split(" ", 1)[1].strip()
        if header_token:
            header_user = _validate_token(header_token)

    if header_user:
        return header_user
    if cookie_user:
        return cookie_user
    return None


def require_user(request: Request) -> AuthenticatedUser:
    user = authenticate_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def verify_csrf(request: Request) -> None:
    if request.method.upper() in SAFE_METHODS:
        return

    path = request.url.path
    if path.startswith("/webhooks/"):
        return
    if path in {"/api/login", "/api/signup", "/api/auth/handoff/exchange", "/api/auth/handoff"}:
        return

    header_token = request.headers.get("x-csrf-token")
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    if not header_token or not cookie_token or header_token != cookie_token:
        raise HTTPException(status_code=403, detail="CSRF validation failed")

    origin = request.headers.get("origin")
    if origin:
        host = request.headers.get("host")
        if host and not origin.endswith(host):
            raise HTTPException(status_code=403, detail="Invalid origin")
