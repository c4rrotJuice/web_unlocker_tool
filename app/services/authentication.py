# app/services/authentication.py

from fastapi import APIRouter, HTTPException
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

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# Routes
@router.post("/signup")
async def signup(payload: SignupRequest):
    try:
        res = supabase.auth.sign_up({
            "email": payload.email,
            "password": payload.password
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    user = res.user
    if not user:
        raise HTTPException(status_code=500, detail="Signup succeeded but user not returned.")

    insert_res = supabase.table("user_meta").insert({
        "user_id": user.id,
        "name": payload.name,
        "use_case": payload.use_case,
        "account_type": "free",
        "daily_limit": 5
    }).execute()
    return {"message": "Signup successful. Please check your email to confirm."}

    if insert_res.error:
        raise HTTPException(status_code=500, detail="Failed to save metadata.")

    return {"message": "Signup successful"}

@router.post("/login")
async def login(payload: LoginRequest):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": payload.email,
            "password": payload.password
        })
        # Check if login was successful
        if res.user is None or res.session is None:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        access_token = res.session.access_token
        return {
            "message": "Login successful",
            "access_token": access_token,
            "user": {
                "id": res.user.id,
                "email": res.user.email,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

