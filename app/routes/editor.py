from __future__ import annotations

from datetime import datetime, timedelta
import html
import json
from io import BytesIO
import os
import re
import zipfile
from typing import Optional
import bleach
import logging
from bs4 import BeautifulSoup
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.services.entitlements import (
    FREE_TIER,
    PRO_TIER,
    STANDARD_TIER,
    get_tier_capabilities,
    normalize_account_type,
)
from app.services.free_tier_gating import (
    ARCHIVED_DOC_MESSAGE,
    FREE_DOCS_PER_WEEK,
    STANDARD_DOCS_PER_14_DAYS,
    STANDARD_DOC_LIMIT_MESSAGE,
    allowed_export_formats,
    current_week_window,
    doc_is_archived,
    rolling_window,
)
from app.services.supabase_rest import SupabaseRestRepository

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_repo = SupabaseRestRepository(base_url=SUPABASE_URL, service_role_key=SUPABASE_KEY)

PAID_TIERS = {"standard", "pro"}
logger = logging.getLogger(__name__)


class DocumentCreate(BaseModel):
    title: Optional[str] = None


class DocumentUpdate(BaseModel):
    title: str
    content_delta: dict
    content_html: Optional[str] = None
    citation_ids: list[str] = []


class ExportRequest(BaseModel):
    style: str = "mla"
    format: str = "pdf"
    html: Optional[str] = None
    text: Optional[str] = None


class CheckpointCreate(BaseModel):
    content_delta: dict
    content_html: Optional[str] = None


class RestoreCheckpointRequest(BaseModel):
    checkpoint_id: str



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


def _iter_export_blocks(content_html: str, bibliography: list[str]) -> list[dict]:
    soup = BeautifulSoup(content_html or "", "html.parser")
    blocks: list[dict] = []

    for node in soup.find_all(["h1", "h2", "h3", "p", "li", "ul", "ol", "blockquote", "pre"], recursive=True):
        tag_name = node.name or "p"
        if node.find_parent(["ul", "ol"]) and tag_name == "li":
            list_type = "ol" if node.find_parent("ol") else "ul"
            blocks.append({"type": "list_item", "list_type": list_type, "text": node.get_text("\n", strip=True)})
            continue
        if tag_name in {"ul", "ol", "li"}:
            continue
        blocks.append({"type": "paragraph", "tag": tag_name, "text": node.get_text("\n", strip=True)})

    if bibliography:
        blocks.append({"type": "paragraph", "tag": "h4", "text": "Bibliography"})
        for entry in bibliography:
            blocks.append({"type": "list_item", "list_type": "ul", "text": entry})
    return blocks


def _build_docx_bytes(content_html: str, bibliography: list[str]) -> bytes:
    paragraphs: list[str] = []
    for block in _iter_export_blocks(content_html, bibliography):
        text = (block.get("text") or "").strip()
        if not text:
            continue
        escaped = html.escape(text)
        escaped = escaped.replace("\n", "</w:t><w:br/><w:t>")
        paragraphs.append(
            '<w:p><w:r><w:t xml:space="preserve">' + escaped + '</w:t></w:r></w:p>'
        )

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
        'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:v="urn:schemas-microsoft-com:vml" '
        'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:w10="urn:schemas-microsoft-com:office:word" '
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
        'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
        'xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" '
        'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" '
        'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">'
        '<w:body>'
        + "".join(paragraphs)
        + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        '</w:body></w:document>'
    )

    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document_xml)
    return output.getvalue()


def _build_pdf_bytes(content_html: str, bibliography: list[str], title: str) -> bytes:
    output = BytesIO()
    doc = SimpleDocTemplate(output, rightMargin=0.75 * inch, leftMargin=0.75 * inch, topMargin=0.75 * inch, bottomMargin=0.75 * inch)
    styles = getSampleStyleSheet()
    story = [Paragraph(html.escape(title or "Document"), styles["Title"]), Spacer(1, 0.2 * inch)]
    pending_list: list[dict] = []

    def flush_list() -> None:
        nonlocal pending_list
        if not pending_list:
            return
        list_items = [ListItem(Paragraph(html.escape(item["text"]), styles["Normal"])) for item in pending_list if item.get("text")]
        if list_items:
            bullet_type = "1" if pending_list[0].get("list_type") == "ol" else "bullet"
            story.append(ListFlowable(list_items, bulletType=bullet_type, leftIndent=18))
            story.append(Spacer(1, 0.1 * inch))
        pending_list = []

    for block in _iter_export_blocks(content_html, bibliography):
        if block["type"] == "list_item":
            pending_list.append(block)
            continue

        flush_list()
        tag = (block.get("tag") or "p").lower()
        text = (block.get("text") or "").strip()
        if not text:
            continue
        style_name = {
            "h1": "Heading1",
            "h2": "Heading2",
            "h3": "Heading3",
            "h4": "Heading4",
            "blockquote": "Italic",
            "pre": "Code",
        }.get(tag, "Normal")
        style = styles.get(style_name, styles["Normal"])
        text = "<br/>".join(html.escape(part) for part in text.split("\n"))
        story.append(Paragraph(text, style))
        story.append(Spacer(1, 0.1 * inch))

    flush_list()
    doc.build(story)
    return output.getvalue()


async def _get_account_type(request: Request, user_id: str) -> str:
    if request.state.account_type:
        return normalize_account_type(request.state.account_type)

    try:
        res = await supabase_repo.get(
            "user_meta",
            params={
                "user_id": f"eq.{user_id}",
                "select": "account_type",
            },
            headers=supabase_repo.headers(include_content_type=False),
        )
        if res.status_code == 200:
            data = res.json()
            if data:
                account_type = normalize_account_type(data[0].get("account_type"))
                request.state.account_type = account_type
                return account_type
    except Exception as e:
        logger.warning("editor.fetch_account_type_failed", extra={"error": str(e), "upstream": "supabase"})

    return normalize_account_type(None)




async def _count_docs_in_window(user_id: str, window_start: datetime, window_end: datetime) -> int:
    res = await supabase_repo.get(
        "documents",
        params={
            "user_id": f"eq.{user_id}",
            "and": f"(created_at.gte.{window_start.isoformat()},created_at.lt.{window_end.isoformat()})",
            "select": "id",
            "limit": 1000,
        },
        headers=supabase_repo.headers(),
    )
    if res.status_code != 200:
        logger.error("editor.count_docs_window_failed", extra={"status": res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to check document quota")
    return len(res.json() or [])


def _quota_for_tier(account_type: str, now: Optional[datetime] = None) -> Optional[dict]:
    normalized = normalize_account_type(account_type)
    capabilities = get_tier_capabilities(normalized)
    if not capabilities.has_document_quota:
        return None
    current = now or datetime.utcnow()
    if capabilities.document_window_days == 7:
        window_start, window_end = current_week_window(current)
        return {
            "limit": capabilities.document_limit or FREE_DOCS_PER_WEEK,
            "window_start": window_start,
            "window_end": window_end,
            "reset_at": window_end.isoformat(),
        }
    if capabilities.document_window_days:
        window_start, window_end = rolling_window(current, capabilities.document_window_days)
        return {
            "limit": capabilities.document_limit or STANDARD_DOCS_PER_14_DAYS,
            "window_start": window_start,
            "window_end": window_end,
            "reset_at": window_end.isoformat(),
        }
    return None


def _doc_limit_toast_payload(account_type: str, used: int, limit: int, reset_at: str) -> dict:
    normalized = normalize_account_type(account_type)
    if normalized == STANDARD_TIER:
        return {
            "code": "STANDARD_DOC_LIMIT_REACHED",
            "message": STANDARD_DOC_LIMIT_MESSAGE,
            "toast": STANDARD_DOC_LIMIT_MESSAGE,
            "quota": {"used": used, "limit": limit, "reset_at": reset_at},
        }
    return {
        "code": "FREE_DOC_LIMIT_REACHED",
        "message": "Maximum of 3 active documents reached. Upgrade to remove limits.",
        "toast": "Maximum of 3 active documents reached. Upgrade to remove limits.",
        "quota": {"used": used, "limit": limit, "reset_at": reset_at},
    }


def _archived_doc_payload() -> dict:
    return {
        "code": "DOC_ARCHIVED",
        "message": ARCHIVED_DOC_MESSAGE,
        "toast": ARCHIVED_DOC_MESSAGE,
    }


async def _fetch_doc_core(user_id: str, doc_id: str) -> dict:
    res = await supabase_repo.get(
        "documents",
        params={
            "id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,title,content_delta,content_html,citation_ids,updated_at,created_at",
            "limit": 1,
        },
        headers=supabase_repo.headers(),
    )
    if res.status_code != 200:
        logger.error("editor.get_doc_failed", extra={"status": res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to load document")
    rows = res.json()
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    return rows[0]


def _doc_expiration(account_type: str) -> Optional[str]:
    capabilities = get_tier_capabilities(account_type)
    if not capabilities.freeze_documents:
        return None
    if normalize_account_type(account_type) in PAID_TIERS:
        return (datetime.utcnow() + timedelta(days=14)).isoformat()
    return None


async def _validate_citation_ids(user_id: str, citation_ids: list[str]) -> list[str]:
    unique_ids = list(dict.fromkeys(citation_ids))
    if len(unique_ids) > 200:
        raise HTTPException(status_code=422, detail="Too many citations attached.")
    if not unique_ids:
        return []

    res = await supabase_repo.get(
        "citations",
        params={
            "id": f"in.({','.join(unique_ids)})",
            "user_id": f"eq.{user_id}",
            "select": "id",
        },
        headers=supabase_repo.headers(),
    )
    if res.status_code != 200:
        logger.error("editor.validate_citations_failed", extra={"status": res.status_code, "upstream": "supabase"})
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
        "select": "id,title,content_delta,content_html,citation_ids,updated_at,created_at",
    }
    res = await supabase_repo.get(
        "documents",
        params=params,
        headers=supabase_repo.headers(),
    )
    if res.status_code != 200:
        fallback = await supabase_repo.get(
            "documents",
            params={
                "id": f"eq.{doc_id}",
                "user_id": f"eq.{user_id}",
                "select": "id,title,content_delta,citation_ids,updated_at,created_at",
            },
            headers=supabase_repo.headers(),
        )
        if fallback.status_code != 200:
            logger.error("editor.get_doc_failed", extra={"status": fallback.status_code, "upstream": "supabase"})
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
    res = await supabase_repo.patch(
        "documents",
        params={
            "id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
        },
        headers={
            **supabase_repo.headers(),
            "Prefer": "return=representation",
        },
        json=payload,
    )
    if res.status_code != 200 and "content_html" in payload:
        fallback_payload = {k: v for k, v in payload.items() if k != "content_html"}
        res = await supabase_repo.patch(
            "documents",
            params={
                "id": f"eq.{doc_id}",
                "user_id": f"eq.{user_id}",
            },
            headers={
                **supabase_repo.headers(),
                "Prefer": "return=representation",
            },
            json=fallback_payload,
        )
    if res.status_code != 200:
        logger.error("editor.update_doc_failed", extra={"status": res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to update document")

    data = res.json()
    if not data:
        raise HTTPException(status_code=404, detail="Document not found")
    return data[0]


@router.get("/editor", response_class=HTMLResponse)
async def editor_page(request: Request):
    user_id = request.state.user_id
    if not user_id:
        return RedirectResponse(url="/auth", status_code=302)

    await _get_account_type(request, user_id)
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
    capabilities = get_tier_capabilities(normalized)
    doc_quota = None
    quota = _quota_for_tier(normalized)
    if quota:
        used = await _count_docs_in_window(user_id, quota["window_start"], quota["window_end"])
        period_label = "current 14-day period" if normalized == STANDARD_TIER else "current week"
        doc_quota = {
            "used": used,
            "limit": quota["limit"],
            "reset_at": quota["reset_at"],
            "window_start": quota["window_start"].isoformat(),
            "window_end": quota["window_end"].isoformat(),
            "period_label": period_label,
        }
    return {
        "account_type": normalized,
        "is_paid": normalized in {STANDARD_TIER, PRO_TIER},
        "doc_quota": doc_quota,
        "can_delete_documents": capabilities.can_delete_documents,
        "freeze_documents": capabilities.freeze_documents,
        "can_zip_export": capabilities.can_zip_export,
    }


@router.post("/api/docs")
async def create_doc(request: Request, payload: DocumentCreate):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    now = datetime.utcnow()
    now_iso = now.isoformat()
    quota = _quota_for_tier(account_type, now)
    if quota:
        used = await _count_docs_in_window(user_id, quota["window_start"], quota["window_end"])
        if used >= quota["limit"]:
            raise HTTPException(status_code=403, detail=_doc_limit_toast_payload(account_type, used, quota["limit"], quota["reset_at"]))

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

    res = await supabase_repo.post(
        "documents",
        headers={
            **supabase_repo.headers(),
            "Prefer": "return=representation",
        },
        json=insert_payload,
    )

    if res.status_code not in (200, 201):
        insert_payload.pop("content_html", None)
        res = await supabase_repo.post(
            "documents",
            headers={
                **supabase_repo.headers(),
                "Prefer": "return=representation",
            },
            json=insert_payload,
        )

    if res.status_code not in (200, 201):
        logger.error("editor.create_doc_failed", extra={"status": res.status_code, "upstream": "supabase"})
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
    res = await supabase_repo.get(
        "documents",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,title,updated_at,created_at",
            "order": "updated_at.desc",
            "or": f"(expires_at.is.null,expires_at.gt.{now_iso})",
        },
        headers=supabase_repo.headers(),
    )

    if res.status_code != 200:
        logger.error("editor.list_docs_failed", extra={"status": res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to load documents")

    account_type = await _get_account_type(request, user_id)
    docs = res.json()
    for doc in docs:
        archived = doc_is_archived(doc.get("created_at"), account_type)
        doc["archived"] = archived
        doc["can_edit"] = not archived
        doc["allowed_export_formats"] = sorted(allowed_export_formats(account_type))
    return docs


@router.get("/api/docs/{doc_id}")
async def get_doc(request: Request, doc_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    doc = await _fetch_doc_with_fallback(user_id, doc_id)
    archived = doc_is_archived(doc.get("created_at"), account_type)
    doc["archived"] = archived
    doc["can_edit"] = not archived
    doc["allowed_export_formats"] = sorted(allowed_export_formats(account_type))
    return doc


@router.put("/api/docs/{doc_id}")
async def update_doc(request: Request, doc_id: str, payload: DocumentUpdate):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    if get_tier_capabilities(account_type).freeze_documents:
        doc = await _fetch_doc_core(user_id, doc_id)
        if doc_is_archived(doc.get("created_at"), account_type):
            raise HTTPException(status_code=403, detail=_archived_doc_payload())

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
    res = await supabase_repo.get(
        "doc_checkpoints",
        params={
            "doc_id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,created_at,content_delta,content_html",
            "order": "created_at.desc",
            "limit": safe_limit,
        },
        headers=supabase_repo.headers(),
    )

    if res.status_code == 404:
        return []
    if res.status_code != 200:
        logger.error("editor.list_checkpoints_failed", extra={"status": res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to load checkpoints")

    return res.json()


@router.post("/api/docs/{doc_id}/checkpoints")
async def create_doc_checkpoint(request: Request, doc_id: str, payload: CheckpointCreate):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    doc = await _fetch_doc_with_fallback(user_id, doc_id)
    if get_tier_capabilities(account_type).freeze_documents and doc_is_archived(doc.get("created_at"), account_type):
        raise HTTPException(status_code=403, detail=_archived_doc_payload())

    now_iso = datetime.utcnow().isoformat()
    insert_payload = {
        "doc_id": doc_id,
        "user_id": user_id,
        "content_delta": payload.content_delta,
        "content_html": payload.content_html,
        "created_at": now_iso,
    }

    res = await supabase_repo.post(
        "doc_checkpoints",
        headers={
            **supabase_repo.headers(),
            "Prefer": "return=representation",
        },
        json=insert_payload,
    )

    if res.status_code == 404:
        return {"created": False, "reason": "checkpoints_not_configured"}
    if res.status_code not in (200, 201):
        logger.error("editor.create_checkpoint_failed", extra={"status": res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to create checkpoint")

    created = res.json()[0]

    # Retention is enforced by clients fetching only the newest checkpoints.
    return created


@router.post("/api/docs/{doc_id}/restore")
async def restore_doc_checkpoint(request: Request, doc_id: str, payload: RestoreCheckpointRequest):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    doc = await _fetch_doc_core(user_id, doc_id)
    if get_tier_capabilities(account_type).freeze_documents and doc_is_archived(doc.get("created_at"), account_type):
        raise HTTPException(status_code=403, detail=_archived_doc_payload())

    checkpoint_res = await supabase_repo.get(
        "doc_checkpoints",
        params={
            "id": f"eq.{payload.checkpoint_id}",
            "doc_id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,content_delta,content_html",
            "limit": 1,
        },
        headers=supabase_repo.headers(),
    )

    if checkpoint_res.status_code != 200:
        logger.error("editor.load_checkpoint_failed", extra={"status": checkpoint_res.status_code, "upstream": "supabase"})
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

    doc_res = await supabase_repo.get(
        "documents",
        params={
            "id": f"eq.{doc_id}",
            "user_id": f"eq.{user_id}",
            "select": "title,content_delta,citation_ids,created_at",
        },
        headers=supabase_repo.headers(),
    )
    if doc_res.status_code != 200:
        logger.error("editor.export_load_doc_failed", extra={"status": doc_res.status_code, "upstream": "supabase"})
        raise HTTPException(status_code=500, detail="Failed to load document")

    doc_data = doc_res.json()
    if not doc_data:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = doc_data[0]
    account_type = await _get_account_type(request, user_id)
    export_format = (payload.format or "pdf").strip().lower()
    archived = doc_is_archived(doc.get("created_at"), account_type)
    allowed_formats = allowed_export_formats(account_type)
    if export_format not in allowed_formats:
        raise HTTPException(status_code=403, detail={"code": "EXPORT_FORMAT_LOCKED", "message": "Export format not available on your plan.", "toast": "Export format not available on your plan."})

    delta = doc.get("content_delta") or {}
    citation_ids = doc.get("citation_ids") or []

    raw_html = _delta_to_html(delta)
    html = _sanitize_html(raw_html)
    text = _delta_to_text(delta)

    bibliography: list[str] = []
    if citation_ids:
        citation_res = await supabase_repo.get(
            "citations",
            params={
                "id": f"in.({','.join(citation_ids)})",
                "user_id": f"eq.{user_id}",
                "expires_at": f"gt.{datetime.utcnow().isoformat()}",
                "select": "id,format,full_text,custom_format_template",
            },
            headers=supabase_repo.headers(),
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
        "format": export_format,
        "archived": archived,
    }


@router.get("/api/docs/{doc_id}/export/file")
async def export_doc_file(request: Request, doc_id: str, format: str = "pdf", style: str = "mla"):
    payload = ExportRequest(style=style, format=format)
    export_data = await export_doc(request, doc_id, payload)

    export_format = (format or "pdf").strip().lower()
    title = (export_data.get("text") or "document").splitlines()[0][:80] or "document"
    safe_title = re.sub(r"[^a-zA-Z0-9_-]+", "-", title).strip("-") or "document"
    bibliography = export_data.get("bibliography") or []
    content_html = export_data.get("html") or ""

    if export_format == "txt":
        text_content = export_data.get("text") or ""
        if bibliography:
            text_content += "\n\nBibliography\n" + "\n".join(f"- {entry}" for entry in bibliography)
        media_type = "text/plain; charset=utf-8"
        body = text_content.encode("utf-8")
    elif export_format == "docx":
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        body = _build_docx_bytes(content_html, bibliography)
    else:
        media_type = "application/pdf"
        body = _build_pdf_bytes(content_html, bibliography, title=title)

    return StreamingResponse(
        BytesIO(body),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.{export_format}"'},
    )


@router.get("/api/docs/export/zip")
async def export_docs_zip(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    capabilities = get_tier_capabilities(account_type)
    if not capabilities.can_zip_export:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "ZIP_EXPORT_LOCKED",
                "message": "ZIP export is available on Pro only.",
                "toast": "Upgrade to Pro to export all documents as ZIP.",
            },
        )

    now_iso = datetime.utcnow().isoformat()
    res = await supabase_repo.get(
        "documents",
        params={
            "user_id": f"eq.{user_id}",
            "select": "id,title,content_delta,citation_ids,created_at",
            "order": "updated_at.desc",
            "or": f"(expires_at.is.null,expires_at.gt.{now_iso})",
            "limit": 1000,
        },
        headers=supabase_repo.headers(),
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to export documents")

    docs = res.json() or []
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        manifest_rows: list[dict] = []
        for idx, doc in enumerate(docs, start=1):
            delta = doc.get("content_delta") or {}
            text = _delta_to_text(delta)
            html = _sanitize_html(_delta_to_html(delta))
            safe_title = re.sub(r"[^a-zA-Z0-9_-]+", "_", (doc.get("title") or f"document_{idx}"))[:60]
            folder = f"{idx:03d}_{safe_title}"
            archive.writestr(f"{folder}/original.txt", text)
            archive.writestr(f"{folder}/pdf_render.html", html)

            bibliography: list[str] = []
            citation_ids = doc.get("citation_ids") or []
            if citation_ids:
                citation_res = await supabase_repo.get(
                    "citations",
                    params={
                        "id": f"in.({','.join(citation_ids)})",
                        "user_id": f"eq.{user_id}",
                        "select": "full_text",
                    },
                    headers=supabase_repo.headers(),
                )
                if citation_res.status_code == 200:
                    bibliography = [item.get("full_text") or "" for item in citation_res.json()]
            archive.writestr(f"{folder}/citations.txt", "\n".join(bibliography))
            manifest_rows.append({"id": doc.get("id"), "title": doc.get("title"), "includes": ["original.txt", "pdf_render.html", "citations.txt"]})

        archive.writestr("manifest.json", json.dumps({"documents": manifest_rows}))

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="pro-documents-export.zip"'},
    )


@router.delete("/api/docs/{doc_id}")
async def delete_doc(request: Request, doc_id: str):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = await _get_account_type(request, user_id)
    if not get_tier_capabilities(account_type).can_delete_documents:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "DOC_DELETE_LOCKED",
                "message": "Document deletion is available on Pro only.",
                "toast": "Upgrade to Pro to permanently delete documents.",
            },
        )

    res = await supabase_repo.delete(
        "documents",
        params={"id": f"eq.{doc_id}", "user_id": f"eq.{user_id}"},
        headers={**supabase_repo.headers(), "Prefer": "return=representation"},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to delete document")

    rows = res.json() or []
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"deleted": True, "id": doc_id}
