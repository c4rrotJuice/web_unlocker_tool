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


'''
@router.get("/api/citations")
async def get_user_citations(authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ")[1]

    try:
        async with httpx.AsyncClient() as client:
            # Step 1: Get current user
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

            # Step 2: Fetch latest 5 citations
            citations_res = await client.get(
                f"{SUPABASE_URL}/rest/v1/citations?user_id=eq.{user_id}&order=cited_at.desc&limit=5",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": SUPABASE_KEY
                }
            )

            if citations_res.status_code != 200:
                raise HTTPException(status_code=500, detail="Failed to fetch citations")

            return citations_res.json()

    except Exception as e:
        print("🔥 Error in GET /api/citations:", str(e))
        raise HTTPException(status_code=500, detail="Server error")


@router.post("/api/citations")
async def add_citation(citation: CitationInput, authorization: str = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    token = authorization.split(" ")[1]

    try:
        async with httpx.AsyncClient() as client:
            # Step 1: Get current user
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

            # Step 2: Insert citation
            payload = {
                "user_id": user_id,
                "url": citation.url,
                "excerpt": citation.excerpt,
                "full_text": citation.full_text,
                "cited_at": datetime.utcnow().isoformat()
            }

            insert_res = await client.post(
                f"{SUPABASE_URL}/rest/v1/citations",
                headers={
                    "Authorization": f"Bearer {token}",
                    "apikey": SUPABASE_KEY,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                json=payload
            )

            if insert_res.status_code not in [200, 201]:
                raise HTTPException(status_code=500, detail="Failed to add citation")

            return {"status": "success"}

    except Exception as e:
        print("🔥 Error in POST /api/citations:", str(e))
        raise HTTPException(status_code=500, detail="Server error")

'''