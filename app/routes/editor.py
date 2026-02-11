from __future__ import annotations

from datetime import datetime, timedelta
import os
import re
from typing import Optional
import bleach

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.routes.http import http_client
from app.services.entitlements import normalize_account_type

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

PAID_TIERS = {"standard", "pro"}


class DocumentCreate(BaseModel):
    title: Optional[str] = None


class DocumentUpdate(BaseModel):
    title: str
    content_delta: dict
    content_html: Optional[str] = None
    citation_ids: list[str] = []


class ExportRequest(BaseModel):
    style: str = "mla"
    html: Optional[str] = None
    text: Optional[str] = None


class CheckpointCreate(BaseModel):
    content_delta: dict
    content_html: Optional[str] = None


class RestoreCheckpointRequest(BaseModel):
    checkpoint_id: str


def _supabase_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def _sanitize_html(html: str) -> str:
    allowed_tags = bleach.sanitizer.ALLOWED_TAGS.union(
        {
            "p",
            "br",
            "span",
            "h1",
            "h2",
            "h3",
            "ul",
            "ol",
            "li",
            "blockquote",
            "pre",
            "code",
        }
    )
    allowed_attributes = {
        **bleach.sanitizer.ALLOWED_ATTRIBUTES,
        "a": ["href", "title", "rel"],
        "span": ["class"],
        "p": ["class"],
    }
    cleaned = bleach.clean(
        html,
        tags=allowed_tags,
        attributes=allowed_attributes,
        protocols=["http", "https", "mailto"],
        strip=True,
    )
    cleaned = re.sub(r"\s+on\w+\s*=\s*(['\"]).*?\1", "", cleaned, flags=re.I | re.S)
    return cleaned


def _delta_to_text(delta: dict) -> str:
    parts: list[str] = []
    for op in delta.get("ops", []):
        insert = op.get("insert")
        if isinstance(insert, str):
            parts.append(insert)
    return "".join(parts)


def _delta_to_html(delta: dict) -> str:
    text = _delta_to_text(delta)
    escaped = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    escaped = escaped.replace("\n", "<br>")
    return f"<p>{escaped}</p>"


async def _get_account_type(request: Request, user_id: str) -> str:
    if request.state.account_type:
        return normalize_account_type(request.state.account_type)

    try:
        res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/user_meta",
            params={
                "user_id": f"eq.{user_id}",
                "select": "account_type",
            },
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            },
        )
        if res.status_code == 200:
            data = res.json()
            if data:
                account_type = normalize_account_type(data[0].get("account_type"))
                request.state.account_type = account_type
                return account_type
    except Exception as e:
        print("⚠️ Failed to fetch account type:", e)

    return normalize_account_type(None)


def _doc_expiration(account_type: str) -> Optional[str]:
    if account_type in PAID_TIERS:
        return (datetime.utcnow() + timedelta(days=14)).isoformat()
    return None


async def _validate_citation_ids(user_id: str, citation_ids: list[str]) -> list[str]:
    unique_ids = list(dict.fromkeys(citation_ids))
    if len(unique_ids) > 200:
        raise HTTPException(status_code=422, detail="Too many citations attached.")
    if not unique_ids:
        return []

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/citations",
        params={
            "id": f"in.({','.join(unique_ids)})",
            "user_id": f"eq.{user_id}",
            "select": "id",
        },
        headers=_supabase_headers(),
    )
    if res.status_code != 200:
        print("❌ Failed to validate citations:", res.text)
        raise HTTPException(status_code=500, detail="Failed to validate citations")

    found_ids = {item.get("id") for item in res.json()}
    missing = [cid for cid in unique_ids if cid not in found_ids]
    if missing:
        raise HTTPException(status_code=403, detail="Invalid citation references.")

    return unique_ids


async def _fetch_doc_with_fallback(user_id: str, doc_id: str) -> dict:
    params = {
        "id": f"eq.{doc_id}",
        "user_id": f"eq.{user_id}",
        "select": "id,title,content_delta,content_html,citation_ids,updated_at",
    }
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/documents",
        params=params,
        headers=_supabase_headers(),
    )
    if res.status_code != 200:
        fallback = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/documents",
            params={
                "id": f"eq.{doc_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,title,content_delta,citation_ids,updated_at",
            },
            headers=_supabase_headers(),
        )
        if fallback.status_code != 200:
            print("❌ Failed to get doc:", fallback.text)
            raise HTTPException(status_code=500, detail="Failed to load document")
        data = fallback.json()
        if not data:
            raise HTTPException(status_code=404, detail="Document not found")
        row = data[0]
        row["content_html"] = None
        return row

    data = res.json()
    if not data:
        raise HTTPException(status_code=404, detail="Document not found")
    return data[0]


async def _patch_doc_with_fallback(user_id: str, doc_id: str, payload: dict) -> dict:
    res = await http_client.patch(
        f"{SUPABASE_URL}/rest/v1/documents",
        params={
            "id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
        },
        headers={
            **_supabase_headers(),
            "Prefer": "return=representation",
        },
        json=payload,
    )
    if res.status_code != 200 and "content_html" in payload:
        fallback_payload = {k: v for k, v in payload.items() if k != "content_html"}
        res = await http_client.patch(
            f"{SUPABASE_URL}/rest/v1/documents",
            params={
                "id": f"eq.{doc_id}",
                "user_id": f"eq.{user_id}",
            },
            headers={
                **_supabase_headers(),
                "Prefer": "return=representation",
            },
            json=fallback_payload,
        )
    if res.status_code != 200:
        print("❌ Failed to update doc:", res.text)
        raise HTTPException(status_code=500, detail="Failed to update document")

    data = res.json()
    if not data:
        raise HTTPException(status_code=404, detail="Document not found")
    return data[0]


@router.get("/editor", response_class=HTMLResponse)
async def editor_page(request: Request):
    return templates.TemplateResponse("editor.html", {"request": request})


@router.get("/api/editor/access")
async def editor_access(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = request.state.account_type
    if not account_type:
        account_type = await _get_account_type(request, user_id)
    normalized = normalize_account_type(account_type)
    return {
        "account_type": normalized,
        "is_paid": normalized in PAID_TIERS,
    }


@router.post("/api/docs")
async def create_doc(request: Request, payload: DocumentCreate):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    if account_type not in PAID_TIERS:
        raise HTTPException(status_code=403, detail="Editor access requires a paid tier.")

    now_iso = datetime.utcnow().isoformat()
    insert_payload = {
        "user_id": user_id,
        "title": payload.title or "Untitled",
        "content_delta": {"ops": [{"insert": "\n"}]},
        "content_html": "<p><br></p>",
        "citation_ids": [],
        "created_at": now_iso,
        "updated_at": now_iso,
        "expires_at": _doc_expiration(account_type),
    }

    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/documents",
        headers={
            **_supabase_headers(),
            "Prefer": "return=representation",
        },
        json=insert_payload,
    )

    if res.status_code not in (200, 201):
        insert_payload.pop("content_html", None)
        res = await http_client.post(
            f"{SUPABASE_URL}/rest/v1/documents",
            headers={
                **_supabase_headers(),
                "Prefer": "return=representation",
            },
            json=insert_payload,
        )

    if res.status_code not in (200, 201):
        print("❌ Failed to create doc:", res.text)
        raise HTTPException(status_code=500, detail="Failed to create document")

    data = res.json()[0]
    return {
        "id": data.get("id"),
        "title": data.get("title"),
        "content_delta": data.get("content_delta"),
        "content_html": data.get("content_html"),
        "citation_ids": data.get("citation_ids"),
        "updated_at": data.get("updated_at"),
    }


@router.get("/api/docs")
async def list_docs(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    now_iso = datetime.utcnow().isoformat()
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/documents",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,title,updated_at",
            "order": "updated_at.desc",
            "or": f"(expires_at.is.null,expires_at.gt.{now_iso})",
        },
        headers=_supabase_headers(),
    )

    if res.status_code != 200:
        print("❌ Failed to list docs:", res.text)
        raise HTTPException(status_code=500, detail="Failed to load documents")

    return res.json()


@router.get("/api/docs/{doc_id}")
async def get_doc(request: Request, doc_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    return await _fetch_doc_with_fallback(user_id, doc_id)


@router.put("/api/docs/{doc_id}")
async def update_doc(request: Request, doc_id: str, payload: DocumentUpdate):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    if account_type not in PAID_TIERS:
        raise HTTPException(status_code=403, detail="Editor access requires a paid tier.")

    validated_citations = await _validate_citation_ids(user_id, payload.citation_ids or [])
    update_payload = {
        "title": payload.title,
        "content_delta": payload.content_delta,
        "content_html": payload.content_html,
        "citation_ids": validated_citations,
        "updated_at": datetime.utcnow().isoformat(),
        "expires_at": _doc_expiration(account_type),
    }

    return await _patch_doc_with_fallback(user_id, doc_id, update_payload)


@router.get("/api/docs/{doc_id}/checkpoints")
async def list_doc_checkpoints(request: Request, doc_id: str, limit: int = 10):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    safe_limit = max(1, min(limit, 20))
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/doc_checkpoints",
        params={
            "doc_id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,created_at,content_delta,content_html",
            "order": "created_at.desc",
            "limit": safe_limit,
        },
        headers=_supabase_headers(),
    )

    if res.status_code == 404:
        return []
    if res.status_code != 200:
        print("❌ Failed to list checkpoints:", res.text)
        raise HTTPException(status_code=500, detail="Failed to load checkpoints")

    return res.json()


@router.post("/api/docs/{doc_id}/checkpoints")
async def create_doc_checkpoint(request: Request, doc_id: str, payload: CheckpointCreate):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    await _fetch_doc_with_fallback(user_id, doc_id)

    now_iso = datetime.utcnow().isoformat()
    insert_payload = {
        "doc_id": doc_id,
        "user_id": user_id,
        "content_delta": payload.content_delta,
        "content_html": payload.content_html,
        "created_at": now_iso,
    }

    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/doc_checkpoints",
        headers={
            **_supabase_headers(),
            "Prefer": "return=representation",
        },
        json=insert_payload,
    )

    if res.status_code == 404:
        return {"created": False, "reason": "checkpoints_not_configured"}
    if res.status_code not in (200, 201):
        print("❌ Failed to create checkpoint:", res.text)
        raise HTTPException(status_code=500, detail="Failed to create checkpoint")

    created = res.json()[0]

    # Retention is enforced by clients fetching only the newest checkpoints.
    return created


@router.post("/api/docs/{doc_id}/restore")
async def restore_doc_checkpoint(request: Request, doc_id: str, payload: RestoreCheckpointRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    checkpoint_res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/doc_checkpoints",
        params={
            "id": f"eq.{payload.checkpoint_id}",
            "doc_id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,content_delta,content_html",
            "limit": 1,
        },
        headers=_supabase_headers(),
    )

    if checkpoint_res.status_code != 200:
        print("❌ Failed to load checkpoint:", checkpoint_res.text)
        raise HTTPException(status_code=500, detail="Failed to restore checkpoint")

    checkpoint_rows = checkpoint_res.json()
    if not checkpoint_rows:
        raise HTTPException(status_code=404, detail="Checkpoint not found")

    checkpoint = checkpoint_rows[0]

    update_payload = {
        "content_delta": checkpoint.get("content_delta") or {"ops": [{"insert": "\n"}]},
        "content_html": checkpoint.get("content_html"),
        "updated_at": datetime.utcnow().isoformat(),
    }

    data = await _patch_doc_with_fallback(user_id, doc_id, update_payload)
    return {
        "id": data.get("id"),
        "title": data.get("title"),
        "content_delta": data.get("content_delta"),
        "content_html": data.get("content_html"),
        "citation_ids": data.get("citation_ids"),
        "updated_at": data.get("updated_at"),
    }


@router.post("/api/docs/{doc_id}/export")
async def export_doc(request: Request, doc_id: str, payload: ExportRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    doc_res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/documents",
        params={
            "id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "title,content_delta,citation_ids",
        },
        headers=_supabase_headers(),
    )
    if doc_res.status_code != 200:
        print("❌ Failed to load doc for export:", doc_res.text)
        raise HTTPException(status_code=500, detail="Failed to load document")

    doc_data = doc_res.json()
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = doc_data[0]
    delta = doc.get("content_delta") or {}
    citation_ids = doc.get("citation_ids") or []

    raw_html = _delta_to_html(delta)
    html = _sanitize_html(raw_html)
    text = _delta_to_text(delta)

    bibliography: list[str] = []
    if citation_ids:
        citation_res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/citations",
            params={
                "id": f"in.({','.join(citation_ids)})",
                "user_id": f"eq.{user_id}",
                "expires_at": f"gt.{datetime.utcnow().isoformat()}",
                "select": "id,format,full_text,custom_format_template",
            },
            headers=_supabase_headers(),
        )
        if citation_res.status_code == 200:
            for citation in citation_res.json():
                fmt = (citation.get("format") or "").lower()
                full_text = citation.get("full_text") or ""
                if fmt == "custom":
                    template = citation.get("custom_format_template") or ""
                    bibliography.append(template or full_text)
                else:
                    bibliography.append(full_text)

    return {
        "html": html,
        "text": text,
        "bibliography": bibliography,
        "style": payload.style,
    }
