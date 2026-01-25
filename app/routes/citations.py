#citations.py
from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel
from datetime import datetime, timedelta
import httpx
from app.routes.http import http_client
import os
from app.services.entitlements import normalize_account_type

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


class CitationInput(BaseModel):
    url: str
    excerpt: str
    full_text: str
    format: str | None = None
    custom_format_name: str | None = None
    custom_format_template: str | None = None
    metadata: dict | None = None


@router.get("/api/citations")
async def get_user_citations(
    request: Request,
    search: str | None = None,
    limit: int = Query(5, le=100),
    format: str | None = None,
):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    now_iso = datetime.utcnow().isoformat()
    params = {
        "user_id": f"eq.{user_id}",
        "expires_at": f"gt.{now_iso}",
        "order": "cited_at.desc",
        "limit": limit,
        "select": "id,url,excerpt,full_text,cited_at,format,metadata,custom_format_template,custom_format_name",
    }

    if search:
        search_term = search.strip()
        if search_term:
            params["or"] = (
                f"(url.ilike.*{search_term}*,"
                f"excerpt.ilike.*{search_term}*,"
                f"full_text.ilike.*{search_term}*,"
                f"metadata.ilike.*{search_term}*)"
            )

    if format:
        params["format"] = f"eq.{format.strip().lower()}"

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/citations",
        params=params,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )

    return res.json()

@router.get("/api/citations/by_ids")
async def get_citations_by_ids(request: Request, ids: str = Query("")):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    raw_ids = [item.strip() for item in ids.split(",") if item.strip()]
    if not raw_ids:
        return []
    if len(raw_ids) > 100:
        raise HTTPException(status_code=422, detail="Too many citation ids requested.")

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/citations",
        params={
            "id": f"in.({','.join(raw_ids)})",
            "user_id": f"eq.{user_id}",
            "select": "id,url,excerpt,full_text,cited_at,format,metadata,custom_format_template,custom_format_name",
        },
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )

    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load citations")

    return res.json()

@router.post("/api/citations")
async def add_citation(request: Request, citation: CitationInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    account_type = normalize_account_type(request.state.account_type)
    citation_format = (citation.format or "mla").strip().lower()

    allowed_formats = {"mla", "apa"}
    if account_type in {"standard", "pro"}:
        allowed_formats.update({"chicago", "harvard"})
    if account_type == "pro":
        allowed_formats.add("custom")

    if citation_format not in allowed_formats:
        raise HTTPException(status_code=403, detail="Citation format not available.")

    if citation_format == "custom":
        if account_type != "pro":
            raise HTTPException(status_code=403, detail="Custom format is Pro-only.")
        if not citation.custom_format_template or not citation.custom_format_template.strip():
            raise HTTPException(
                status_code=422,
                detail="Custom format template is required.",
            )
        if not citation.full_text.strip():
            raise HTTPException(
                status_code=422,
                detail="Custom citations must include text.",
            )
    else:
        if citation.custom_format_template:
            raise HTTPException(
                status_code=422,
                detail="Custom format template only allowed for custom format.",
            )

    if account_type == "pro" and citation.url not in citation.full_text:
        raise HTTPException(
            status_code=422,
            detail="Citations must include the source URL.",
        )

    cited_at = datetime.utcnow()
    expires_at = cited_at + timedelta(days=30)

    payload = {
        "user_id": user_id,
        "url": citation.url,
        "excerpt": citation.excerpt,
        "full_text": citation.full_text,
        "format": citation_format,
        "custom_format_name": citation.custom_format_name,
        "custom_format_template": citation.custom_format_template,
        "metadata": citation.metadata,
        "cited_at": cited_at.isoformat(),
        "expires_at": expires_at.isoformat(),
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
    
    cutoff = datetime.utcnow() - timedelta(days=30)
    cutoff_iso = cutoff.isoformat()
    await http_client.delete(
        f"{SUPABASE_URL}/rest/v1/citations"
        f"?user_id=eq.{user_id}&expires_at=lt.{cutoff_iso}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )
    return {"status": "success"}


