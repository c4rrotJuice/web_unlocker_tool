# app/services/authentication.py

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
router = APIRouter(prefix="/api", tags=["Auth"])


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
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password,
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    user = res.user
    if not user:
        raise HTTPException(status_code=500, detail="Signup succeeded but user not returned.")

    try:
        supabase.table("user_meta").insert({
            "user_id": user.id,
            "name": payload.name,
            "use_case": payload.use_case,
            "account_type": "free",
            "daily_limit": 5,
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save metadata: {e}")

    return {"message": "Signup successful. Please check your email to confirm."}


@router.post("/login")
async def login(payload: LoginRequest, response: Response):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": payload.email,
            "password": payload.password,
        })
        if res.user is None or res.session is None:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        access_token = res.session.access_token
        refresh_token = res.session.refresh_token
        expires_in = res.session.expires_in
        token_type = res.session.token_type

        cookie_secure_default = os.getenv("COOKIE_SECURE", "true").lower() != "false"
        response.set_cookie(
            "access_token",
            access_token,
            httponly=True,
            secure=cookie_secure_default,
            samesite="lax",
            max_age=expires_in or 3600,
            path="/",
        )
        response.set_cookie(
            "refresh_token",
            refresh_token,
            httponly=True,
            secure=cookie_secure_default,
            samesite="lax",
            max_age=60 * 60 * 24 * 30,
            path="/",
        )

        return {
            "message": "Login successful",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": expires_in,
            "token_type": token_type,
            "user": {
                "id": res.user.id,
                "email": res.user.email,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
