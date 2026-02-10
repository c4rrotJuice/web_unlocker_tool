from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import secrets

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from supabase import create_client


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
DEBUG_AUTH_HANDOFF = os.getenv("DEBUG_AUTH_HANDOFF", "").lower() in {
    "1",
    "true",
    "yes",
}

supabase_anon = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

router = APIRouter(prefix="/api/auth", tags=["Auth"])

HANDOFF_TTL_SECONDS = 60
HANDOFF_RATE_LIMIT = 5
HANDOFF_EXCHANGE_RATE_LIMIT = 20


def _debug_log(message: str) -> None:
    if DEBUG_AUTH_HANDOFF:
        print(f"[auth_handoff] {message}")


def _redact_secrets(message: str, *, tokens: list[str]) -> str:
    redacted = message
    for token in tokens:
        if token:
            redacted = redacted.replace(token, "<redacted>")
    return redacted


class HandoffRequest(BaseModel):
    redirect_path: str | None = None
    refresh_token: str | None = None
    expires_in: int | None = None
    token_type: str | None = None


class HandoffExchangeRequest(BaseModel):
    code: str


def _normalize_redirect_path(path: str | None) -> str:
    if not path:
        return "/editor"
    if not path.startswith("/"):
        return "/editor"
    if "://" in path:
        return "/editor"
    if "//" in path:
        return "/editor"
    return path


async def _rate_limit_handoff(request: Request, user_id: str) -> None:
    key = f"handoff:{user_id}"
    try:
        count = await request.app.state.redis_incr(key)
        if count == 1:
            await request.app.state.redis_expire(key, 60)
        if count > HANDOFF_RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Too many handoff requests.")
    except HTTPException:
        raise
    except Exception as exc:
        print("⚠️ Failed to apply handoff rate limit:", exc)


async def _rate_limit_handoff_exchange(request: Request) -> None:
    forwarded = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded.split(",")[0].strip() if forwarded else None
    if not client_ip:
        client_ip = getattr(request.client, "host", "unknown")

    key = f"handoff:exchange:{client_ip}"
    try:
        count = await request.app.state.redis_incr(key)
        if count == 1:
            await request.app.state.redis_expire(key, 60)
        if count > HANDOFF_EXCHANGE_RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Too many exchange requests.")
    except HTTPException:
        raise
    except Exception as exc:
        print("⚠️ Failed to apply handoff exchange rate limit:", exc)


@router.post("/handoff")
async def create_handoff(request: Request, payload: HandoffRequest):
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = auth_header.split(" ")[1]
    try:
        user_res = supabase_anon.auth.get_user(token)
        user = user_res.user
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    await _rate_limit_handoff(request, user.id)

    redirect_path = _normalize_redirect_path(payload.redirect_path)
    refresh_token = (payload.refresh_token or "").strip()
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Missing refresh token.")
    code = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=HANDOFF_TTL_SECONDS)
    code_prefix = code[:6]
    _debug_log(
        "create started: "
        f"user_id={user.id} code_prefix={code_prefix} redirect_path={redirect_path}"
    )

    insert_res = (
        supabase_admin
        .table("auth_handoff_codes")
        .insert(
            {
                "code": code,
                "user_id": user.id,
                "redirect_path": redirect_path,
                "expires_at": expires_at.isoformat(),
                "access_token": token,
                "refresh_token": refresh_token,
                "expires_in": payload.expires_in,
                "token_type": payload.token_type,
            }
        )
        .execute()
    )

    data = getattr(insert_res, "data", None)
    if not data:
        err = getattr(insert_res, "error", None)
        if err:
            safe_error = _redact_secrets(
                str(err),
                tokens=[token, refresh_token, code],
            )
            _debug_log(
                "create failed: "
                f"code_prefix={code_prefix} error={safe_error}"
            )
        else:
            _debug_log(f"create failed: code_prefix={code_prefix} no data returned")
        raise HTTPException(status_code=500, detail="Failed to create handoff code.")

    _debug_log(f"create success: code_prefix={code_prefix}")

    return {"code": code, "redirect_path": redirect_path}


@router.post("/handoff/exchange")
async def exchange_handoff(request: Request, payload: HandoffExchangeRequest):
    await _rate_limit_handoff_exchange(request)

    code = (payload.code or "").strip()
    if not code:
        _debug_log("exchange rejected: missing code")
        raise HTTPException(status_code=400, detail="Missing code.")

    code_prefix = code[:6]
    _debug_log(f"exchange started: code_prefix={code_prefix}")

    res = (
        supabase_admin
        .table("auth_handoff_codes")
        .select("*")
        .eq("code", code)
        .single()
        .execute()
    )

    record = getattr(res, "data", None)
    if not record:
        err = getattr(res, "error", None)
        if err:
            _debug_log(
                f"exchange failed: code_prefix={code_prefix} not found error={err}"
            )
        else:
            _debug_log(f"exchange failed: code_prefix={code_prefix} not found")
        raise HTTPException(status_code=404, detail="Invalid or expired code.")

    if record.get("used_at"):
        _debug_log(f"exchange rejected: code_prefix={code_prefix} already used")
        raise HTTPException(status_code=400, detail="Code already used.")

    expires_at = record.get("expires_at")
    if expires_at:
        try:
            expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if expires_dt < datetime.now(timezone.utc):
                _debug_log(f"exchange rejected: code_prefix={code_prefix} expired")
                raise HTTPException(status_code=400, detail="Code expired.")
        except ValueError:
            _debug_log(f"exchange rejected: code_prefix={code_prefix} invalid expiry")
            raise HTTPException(status_code=400, detail="Invalid code expiry.")

    access_token = record.get("access_token")
    refresh_token = record.get("refresh_token")
    expires_in = record.get("expires_in")
    token_type = record.get("token_type")
    if not access_token:
        _debug_log(f"exchange rejected: code_prefix={code_prefix} missing access")
        raise HTTPException(status_code=400, detail="Code not exchangeable.")
    if not refresh_token:
        _debug_log(f"exchange rejected: code_prefix={code_prefix} missing refresh")
        raise HTTPException(status_code=400, detail="Code missing refresh token.")

    user = None
    try:
        user_res = supabase_anon.auth.get_user(access_token)
        user = user_res.user
    except Exception as exc:
        _debug_log(f"exchange token check failed: code_prefix={code_prefix} {exc}")

    if not user:
        try:
            refresh_res = supabase_anon.auth.refresh_session(refresh_token)
            refreshed_session = getattr(refresh_res, "session", None)
            refreshed_access_token = getattr(refreshed_session, "access_token", None)
            refreshed_refresh_token = getattr(refreshed_session, "refresh_token", None)
            refreshed_expires_in = getattr(refreshed_session, "expires_in", None)
            refreshed_token_type = getattr(refreshed_session, "token_type", None)
            if refreshed_access_token:
                access_token = refreshed_access_token
                if refreshed_refresh_token:
                    refresh_token = refreshed_refresh_token
                if refreshed_expires_in is not None:
                    expires_in = refreshed_expires_in
                if refreshed_token_type:
                    token_type = refreshed_token_type
                user_res = supabase_anon.auth.get_user(access_token)
                user = user_res.user
        except Exception as exc:
            _debug_log(
                f"exchange refresh failed: code_prefix={code_prefix} {exc}"
            )

    if not user:
        _debug_log(f"exchange rejected: code_prefix={code_prefix} signed out")
        raise HTTPException(status_code=401, detail="SIGNED_OUT")

    update_query = (
        supabase_admin
        .table("auth_handoff_codes")
        .update(
            {
                "used_at": datetime.now(timezone.utc).isoformat(),
                "access_token": None,
                "refresh_token": None,
                "expires_in": None,
                "token_type": None,
            }
        )
        .eq("id", record.get("id"))
    )

    if hasattr(update_query, "is_"):
        update_query = update_query.is_("used_at", "null")

    update_res = update_query.execute()

    updated = getattr(update_res, "data", None)
    if not updated:
        err = getattr(update_res, "error", None)
        if err:
            _debug_log(
                f"exchange failed: code_prefix={code_prefix} update error={err}"
            )
        else:
            _debug_log(f"exchange rejected: code_prefix={code_prefix} already used")
        raise HTTPException(status_code=400, detail="Code already used.")

    redirect_path = record.get("redirect_path") or "/editor"
    _debug_log(
        "exchange success: "
        f"code_prefix={code_prefix} user_id={user.id} redirect_path={redirect_path}"
    )
    return JSONResponse(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": (
                int(expires_in)
                if isinstance(expires_in, int) and expires_in > 0
                else 60 * 60
            ),
            "token_type": token_type or "bearer",
            "user": {
                "id": user.id,
                "email": user.email,
            },
            "redirect_path": redirect_path,
        }
    )
