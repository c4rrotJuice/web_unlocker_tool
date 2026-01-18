#search.py
from fastapi import APIRouter, Header, HTTPException, Query, Request
import httpx, os
from app.routes.http import http_client

router = APIRouter()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


async def get_user_id_from_token(token: str):
    """Validate token with Supabase and return the user ID."""
    res = await http_client.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "Authorization": f"Bearer {token}",
            "apikey": SUPABASE_KEY
        }
    )
    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    data = res.json()
    user_id = data.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not retrieve user ID")
    return user_id


@router.get("/api/history")
async def get_full_history(
    q: str = Query(None, description="Search query for URL"),
    limit: int = Query(50, le=200, description="Max number of results"),
    authorization: str = Header(None)
):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ")[1]
    user_id = await get_user_id_from_token(token)

    # Build filter for Supabase
    filter_str = f"user_id=eq.{user_id}"
    if q:
        filter_str += f"&url.ilike.%25{q}%25"

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/unlock_history?{filter_str}&order=unlocked_at.desc&limit={limit}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {token}"
        }
    )

    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Error fetching history")

    return res.json()

