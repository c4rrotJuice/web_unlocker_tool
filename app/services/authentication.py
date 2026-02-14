# app/services/authentication.py

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client
import os
from dotenv import load_dotenv
from supabase.client import AuthApiError
import logging

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
router = APIRouter(prefix="/api", tags=["Auth"])
logger = logging.getLogger(__name__)

# Pydantic Models
class SignupRequest(BaseModel):
    name: str
    email: EmailStr | None = None
    password: str | None = None
    use_case: str
    user_id: str | None = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# Routes
@router.post("/signup")
async def signup(payload: SignupRequest):
    res = None
    metadata_payload = {
        "name": payload.name,
        "use_case": payload.use_case,
    }

    if not payload.user_id:
        if not payload.email or not payload.password:
            raise HTTPException(status_code=422, detail="email and password are required when user_id is not provided")
        try:
            res = supabase.auth.sign_up({
                "email": payload.email,
                "password": payload.password,
                "options": {
                    "data": metadata_payload,
                },
            })
        except AuthApiError as exc:
            raise HTTPException(status_code=400, detail=exc.message)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    user_id = payload.user_id
    if not user_id:
        user = res.user
        if not user:
            raise HTTPException(status_code=500, detail="Signup succeeded but user not returned.")
        user_id = user.id

    try:
        supabase.auth.admin.update_user_by_id(user_id, {
            "user_metadata": metadata_payload,
        })
    except Exception as exc:
        logger.warning("auth.signup_metadata_update_failed", extra={"user_id": user_id, "error": str(exc)})

    try:
        supabase.table("user_meta").upsert({
            "user_id": user_id,
            "name": payload.name,
            "use_case": payload.use_case,
            "account_type": "free",
            "daily_limit": 5
        }, on_conflict="user_id").execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to save metadata.") from exc

    return {"message": "Signup successful. Please check your email to confirm."}

@router.post("/login")
async def login(payload: LoginRequest, response: Response):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": payload.email,
            "password": payload.password
        })
        # Check if login was successful
        if res.user is None or res.session is None:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        access_token = res.session.access_token
        refresh_token = res.session.refresh_token

        response.set_cookie(
            key="wu_access_token",
            value=access_token,
            httponly=False,
            samesite="lax",
            secure=False,
            path="/",
        )

        return {
            "message": "Login successful",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "user": {
                "id": res.user.id,
                "email": res.user.email,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
