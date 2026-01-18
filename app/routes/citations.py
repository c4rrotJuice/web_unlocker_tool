#citations.py
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel
from datetime import datetime
import httpx
from app.routes.http import http_client
import os

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


class CitationInput(BaseModel):
    url: str
    excerpt: str
    full_text: str


@router.get("/api/citations")
async def get_user_citations(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/citations"
        f"?user_id=eq.{user_id}&order=cited_at.desc&limit=5",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
    )

    return res.json()


@router.post("/api/citations")
async def add_citation(request: Request, citation: CitationInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    payload = {
        "user_id": user_id,
        "url": citation.url,
        "excerpt": citation.excerpt,
        "full_text": citation.full_text,
        "cited_at": datetime.utcnow().isoformat()
    }

    
    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/citations",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json=payload
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to add citation")
    return {"status": "success"}


