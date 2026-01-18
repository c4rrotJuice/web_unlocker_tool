#dashboard.py
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

@router.get("/api/me")
async def get_user_metadata(request: Request):
    """
    Dashboard bootstrap endpoint.
    Auth is already handled by middleware.
    """

    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        # ── Fetch user_meta (already partly cached in middleware, but we need extra fields)
        meta_res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/user_meta",
            params={
                "user_id": f"eq.{user_id}",
                "select": "name,account_type,daily_limit,requests_today"
            },
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            }
        )

        if meta_res.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to load user metadata")

        meta = meta_res.json()
        if not meta:
            raise HTTPException(status_code=404, detail="User metadata not found")

        meta = meta[0]

        # ── Fetch latest bookmarks
        bookmarks_res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/bookmarks",
            params={
                "user_id": f"eq.{user_id}",
                "order": "created_at.desc",
                "limit": 50
            },
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            }
        )

        bookmarks = bookmarks_res.json() if bookmarks_res.status_code == 200 else []

        return {
            "user_id": user_id,
            "name": meta.get("name"),
            "account_type": meta.get("account_type"),
            "daily_limit": meta.get("daily_limit"),
            "requests_today": meta.get("requests_today"),
            "bookmarks": bookmarks,
        }

    except HTTPException:
        raise
    except Exception as e:
        print("🔥 Error in /api/me:", str(e))
        raise HTTPException(status_code=500, detail="Internal server error")

