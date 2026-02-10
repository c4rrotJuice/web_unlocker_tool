from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
import supabase
import os
from dotenv import load_dotenv

from app.services.auth_session import (
    apply_auth_cookies,
    authenticate_request,
    clear_auth_cookies,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

router = APIRouter(prefix="/api", tags=["Auth"])


def _supabase_admin_client():
    return supabase.create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    use_case: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup")
async def signup(payload: SignupRequest):
    try:
        res = _supabase_admin_client().auth.sign_up(
            {
                "email": payload.email,
                "password": payload.password,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    user = res.user
    if not user:
        raise HTTPException(status_code=500, detail="Signup succeeded but user not returned.")

    _supabase_admin_client().table("user_meta").insert(
        {
            "user_id": user.id,
            "name": payload.name,
            "use_case": payload.use_case,
            "account_type": "free",
            "daily_limit": 5,
        }
    ).execute()

    return {"message": "Signup successful. Please check your email to confirm."}


@router.post("/login")
async def login(payload: LoginRequest, request: Request):
    try:
        res = _supabase_admin_client().auth.sign_in_with_password(
            {
                "email": payload.email,
                "password": payload.password,
            }
        )
        if res.user is None or res.session is None:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        response = JSONResponse(
            {
                "ok": True,
                "user": {
                    "id": res.user.id,
                    "email": res.user.email,
                },
            }
        )
        apply_auth_cookies(
            request,
            response,
            access_token=res.session.access_token,
            refresh_token=res.session.refresh_token,
            access_max_age=int(getattr(res.session, "expires_in", 3600) or 3600),
        )
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/auth/me")
async def auth_me(request: Request):
    user = authenticate_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    return {
        "user_id": user.id,
        "email": user.email,
        "name": request.state.name,
        "account_type": request.state.account_type,
    }


@router.post("/auth/refresh")
async def refresh_auth(request: Request):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        refresh_res = _supabase_admin_client().auth.refresh_session(refresh_token)
        refreshed_session = getattr(refresh_res, "session", None)
        refreshed_access_token = getattr(refreshed_session, "access_token", None)
        refreshed_refresh_token = getattr(refreshed_session, "refresh_token", None)
        refreshed_expires_in = int(getattr(refreshed_session, "expires_in", 3600) or 3600)
        if not refreshed_access_token:
            raise HTTPException(status_code=401, detail="Unauthorized")

        response = JSONResponse({"ok": True})
        apply_auth_cookies(
            request,
            response,
            access_token=refreshed_access_token,
            refresh_token=refreshed_refresh_token,
            access_max_age=refreshed_expires_in,
        )
        return response
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/auth/logout")
async def logout(request: Request):
    response = JSONResponse({"ok": True})
    clear_auth_cookies(request, response)
    return response
