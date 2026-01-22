#bookmarks.py
from fastapi import APIRouter, Header, HTTPException, Request
import httpx, os
from app.routes.http import http_client
from app.services.entitlements import can_use_bookmarks, normalize_account_type

router = APIRouter()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

@router.get("/api/bookmarks")
async def get_bookmarks(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = normalize_account_type(request.state.account_type)
    if not can_use_bookmarks(account_type):
        raise HTTPException(status_code=403, detail="Bookmarks are a Standard feature.")

    
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/bookmarks"
        f"?user_id=eq.{user_id}&order=created_at.desc",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
    )
    return res.json()


@router.post("/api/bookmarks")
async def add_bookmark(request: Request, bookmark: dict):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = normalize_account_type(request.state.account_type)
    if not can_use_bookmarks(account_type):
        raise HTTPException(status_code=403, detail="Bookmarks are a Standard feature.")

    bookmark["user_id"] = user_id

    
    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/bookmarks",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation"
        },
        json=bookmark
    )

    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to add bookmark")
    return res.json()


@router.delete("/api/bookmarks/{bookmark_id}")
async def delete_bookmark(request: Request, bookmark_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = normalize_account_type(request.state.account_type)
    if not can_use_bookmarks(account_type):
        raise HTTPException(status_code=403, detail="Bookmarks are a Standard feature.")

    
    res = await http_client.delete(
        f"{SUPABASE_URL}/rest/v1/bookmarks"
        f"?id=eq.{bookmark_id}&user_id=eq.{user_id}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
    )

    if res.status_code != 204:
        raise HTTPException(status_code=500, detail="Failed to delete bookmark")
    return {"status": "success"}

