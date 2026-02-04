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

supabase_anon = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

router = APIRouter(prefix="/api/auth", tags=["Auth"])

HANDOFF_TTL_SECONDS = 60
HANDOFF_RATE_LIMIT = 5


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

    if insert_res.error:
        raise HTTPException(status_code=500, detail="Failed to create handoff code.")

    return {"code": code, "redirect_path": redirect_path}


@router.post("/handoff/exchange")
async def exchange_handoff(payload: HandoffExchangeRequest):
    code = (payload.code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Missing code.")

    res = (
        supabase_admin
        .table("auth_handoff_codes")
        .select("*")
        .eq("code", code)
        .single()
        .execute()
    )

    if res.error or not res.data:
        raise HTTPException(status_code=404, detail="Invalid or expired code.")

    record = res.data
    if record.get("used_at"):
        raise HTTPException(status_code=400, detail="Code already used.")

    expires_at = record.get("expires_at")
    if expires_at:
        try:
            expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if expires_dt < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Code expired.")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid code expiry.")

    access_token = record.get("access_token")
    refresh_token = record.get("refresh_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Code not exchangeable.")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Code missing refresh token.")

    try:
        user_res = supabase_anon.auth.get_user(access_token)
        user = user_res.user
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid access token.") from exc

    if not user:
        raise HTTPException(status_code=400, detail="Invalid access token.")

    if hasattr(user, "model_dump"):
        user_payload = user.model_dump()
    elif hasattr(user, "dict"):
        user_payload = user.dict()
    else:
        user_payload = user

    update_res = (
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
        .execute()
    )

    if update_res.error:
        raise HTTPException(status_code=500, detail="Failed to finalize handoff.")

    response = JSONResponse(
        {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": record.get("expires_in") or 0,
            "token_type": record.get("token_type") or "bearer",
            "user": user_payload,
            "redirect_path": record.get("redirect_path") or "/editor",
        }
    )
    secure_cookie = os.getenv("COOKIE_SECURE", "true").lower() != "false"
    response.set_cookie(
        "access_token",
        access_token,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        max_age=3600,
        path="/",
    )
    return response
