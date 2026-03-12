#history.py
from fastapi import APIRouter, Request, Depends, Header, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from datetime import date
import httpx
from app.routes.http import http_client
from app.services.entitlements import normalize_account_type
import os

templates = Jinja2Templates(directory="app/templates")
router = APIRouter()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

@router.get("/api/unlocks")
async def get_user_unlocks(request: Request, limit: int | None = Query(None, ge=1, le=200)):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    account_type = normalize_account_type(request.state.account_type)
    if account_type not in {"free", "standard", "pro", "dev"}:
        raise HTTPException(status_code=403, detail="History access not available.")

    
    is_paid = account_type in {"standard", "pro", "dev"}
    effective_limit = min(limit or (100 if is_paid else 5), 100 if is_paid else 5)

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/unlock_history"
        f"?user_id=eq.{user_id}&order=unlocked_at.desc&limit={effective_limit}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
    )
    return res.json()
