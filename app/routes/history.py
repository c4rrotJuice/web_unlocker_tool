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
