#citations.py
from datetime import datetime, timedelta
import os

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.routes.http import http_client
from app.services.citation_templates import render_template, validate_template
from app.services.entitlements import get_tier_capabilities, normalize_account_type
from app.services.free_tier_gating import allowed_citation_formats

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


class CitationTemplateInput(BaseModel):
    name: str
    template: str


def _pro_only_for_templates(account_type: str):
    caps = get_tier_capabilities(account_type)
    if not caps.can_use_custom_citation_templates:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "CITATION_TEMPLATE_PRO_ONLY",
                "message": "Custom citation templates are available on Pro only.",
                "toast": "Upgrade to Pro to use custom citation templates.",
            },
        )


async def create_citation(
    user_id: str,
    account_type: str,
    citation: CitationInput,
) -> str:
    citation_format = (citation.format or "mla").strip().lower()
    normalized_account_type = normalize_account_type(account_type)
    allowed_formats = allowed_citation_formats(normalized_account_type)

    if citation_format not in allowed_formats:
        raise HTTPException(status_code=403, detail={"code": "CITATION_FORMAT_LOCKED", "message": "Citation format not available on your plan.", "toast": "Upgrade to unlock this citation format."})

    if citation_format == "custom":
        _pro_only_for_templates(normalized_account_type)
        template = (citation.custom_format_template or "").strip()
        ok, error = validate_template(template)
        if not ok:
            raise HTTPException(status_code=422, detail=error)
    else:
        if citation.custom_format_template:
            raise HTTPException(
                status_code=422,
                detail="Custom format template only allowed for custom format.",
            )

    if get_tier_capabilities(normalized_account_type).can_use_custom_citation_templates and citation.url not in citation.full_text:
        raise HTTPException(
            status_code=422,
            detail="Citations must include the source URL.",
        )

    metadata = citation.metadata or {}
    if citation_format == "custom":
        rendered = render_template(citation.custom_format_template or "", {
            "citation_text": citation.full_text,
            "url": citation.url,
            **metadata,
        })
        full_text = rendered
    else:
        full_text = citation.full_text

    cited_at = datetime.utcnow()
    expires_at = cited_at + timedelta(days=30)

    payload = {
        "user_id": user_id,
        "url": citation.url,
        "excerpt": citation.excerpt,
        "full_text": full_text,
        "format": citation_format,
        "custom_format_name": citation.custom_format_name,
        "custom_format_template": citation.custom_format_template,
        "metadata": metadata,
        "cited_at": cited_at.isoformat(),
        "expires_at": expires_at.isoformat(),
    }

    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/citations",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=payload,
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to add citation")

    data = res.json()
    if not data:
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
    return data[0].get("id")


@router.get("/api/citation-templates")
async def list_citation_templates(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        params={"user_id": f"eq.{user_id}", "select": "id,name,template,created_at,updated_at", "order": "updated_at.desc"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load citation templates")
    return res.json()


@router.post("/api/citation-templates")
async def create_citation_template(request: Request, payload: CitationTemplateInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    ok, error = validate_template(payload.template)
    if not ok:
        raise HTTPException(status_code=422, detail=error)

    now_iso = datetime.utcnow().isoformat()
    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"user_id": user_id, "name": payload.name.strip()[:80], "template": payload.template, "created_at": now_iso, "updated_at": now_iso},
    )
    if res.status_code not in (200, 201):
        raise HTTPException(status_code=500, detail="Failed to create citation template")
    return res.json()[0]


@router.put("/api/citation-templates/{template_id}")
async def update_citation_template(request: Request, template_id: str, payload: CitationTemplateInput):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    ok, error = validate_template(payload.template)
    if not ok:
        raise HTTPException(status_code=422, detail=error)

    res = await http_client.patch(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        params={"id": f"eq.{template_id}", "user_id": f"eq.{user_id}"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"},
        json={"name": payload.name.strip()[:80], "template": payload.template, "updated_at": datetime.utcnow().isoformat()},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to update citation template")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    return rows[0]


@router.delete("/api/citation-templates/{template_id}")
async def delete_citation_template(request: Request, template_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_type = normalize_account_type(request.state.account_type)
    _pro_only_for_templates(account_type)

    res = await http_client.delete(
        f"{SUPABASE_URL}/rest/v1/citation_templates",
        params={"id": f"eq.{template_id}", "user_id": f"eq.{user_id}"},
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Prefer": "return=representation"},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to delete citation template")
    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True, "id": template_id}


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
    citation_id = await create_citation(user_id, account_type, citation)
    return {"status": "success", "citation_id": citation_id}
