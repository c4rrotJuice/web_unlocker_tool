# app/services/authentication.py

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, EmailStr
from supabase import create_client, Client
import os
from dotenv import load_dotenv
from supabase.client import AuthApiError

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
router = APIRouter(prefix="/api", tags=["Auth"])

# Pydantic Models
class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    use_case: str
    user_id: str | None = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# Routes
@router.post("/signup")
async def signup(payload: SignupRequest):
    res = None
    if not payload.user_id:
        try:
            res = supabase.auth.sign_up({
                "email": payload.email,
                "password": payload.password
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
