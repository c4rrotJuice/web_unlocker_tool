#history.py
from fastapi import APIRouter, Request, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from datetime import date
import httpx
from app.routes.http import http_client
import os

templates = Jinja2Templates(directory="app/templates")
router = APIRouter()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

@router.get("/api/unlocks")
async def get_user_unlocks(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/unlock_history"
        f"?user_id=eq.{user_id}&order=unlocked_at.desc&limit=5",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
    )
    return res.json()

'''
@router.get("/api/unlocks")
async def get_user_unlocks(authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ")[1]

    try:
        async with httpx.AsyncClient() as client:
            user_res = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": SUPABASE_KEY
                }
            )
            if user_res.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid token")

            user_id = user_res.json().get("id")

            history_res = await client.get(
                f"{SUPABASE_URL}/rest/v1/unlock_history?user_id=eq.{user_id}&order=unlocked_at.desc&limit=5",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {token}"
                }
            )

            if history_res.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch history")

            return history_res.json()

    except Exception as e:
        print("🔥 Error in /api/unlocks:", str(e))
        raise HTTPException(status_code=500, detail="Server error")

'''