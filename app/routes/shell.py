from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.core.config import get_settings
from app.core.security import validate_internal_redirect_path

router = APIRouter(tags=["shell"])
templates = Jinja2Templates(directory="app/templates")
settings = get_settings()


def _shell_context(*, request: Request, page: str, title: str, nav_key: str, page_state: dict[str, object] | None = None) -> dict[str, object]:
    return {
        "request": request,
        "page_id": page,
        "page_title": title,
        "nav_key": nav_key,
        "boot_payload": json.dumps(
            {
                "page": page,
                "title": title,
                "nav": nav_key,
                "page_state": page_state or {},
            }
        ),
    }


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "home.html", {"request": request})


@router.get("/auth", response_class=HTMLResponse)
async def auth_page(request: Request):
    next_path = validate_internal_redirect_path(request.query_params.get("next"))
    return templates.TemplateResponse(
        request,
        "auth.html",
        {
            "request": request,
            "supabase_url": settings.supabase_url,
            "supabase_key": settings.supabase_anon_key,
            "next_path": next_path,
        },
    )


@router.get("/pricing", response_class=HTMLResponse)
async def pricing_redirect():
    return RedirectResponse(url="/static/pricing.html", status_code=307)


@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request,
        "app_dashboard.html",
        _shell_context(request=request, page="dashboard", title="Dashboard", nav_key="dashboard"),
    )


@router.get("/projects", response_class=HTMLResponse)
async def projects(request: Request):
    return templates.TemplateResponse(
        request,
        "app_projects.html",
        _shell_context(request=request, page="projects", title="Projects", nav_key="projects", page_state={"project_id": None}),
    )


@router.get("/projects/{project_id}", response_class=HTMLResponse)
async def project_detail(request: Request, project_id: str):
    return templates.TemplateResponse(
        request,
        "app_projects.html",
        _shell_context(
            request=request,
            page="projects",
            title="Project",
            nav_key="projects",
            page_state={"project_id": project_id},
        ),
    )


@router.get("/research", response_class=HTMLResponse)
async def research(request: Request):
    return templates.TemplateResponse(
        request,
        "app_research.html",
        _shell_context(
            request=request,
            page="research",
            title="Research Explorer",
            nav_key="research",
            page_state={
                "tab": request.query_params.get("tab") or "sources",
                "project": request.query_params.get("project") or "",
                "tag": request.query_params.get("tag") or "",
                "q": request.query_params.get("q") or "",
                "selected": request.query_params.get("selected") or "",
            },
        ),
    )


@router.get("/editor", response_class=HTMLResponse)
async def editor(request: Request):
    page_state = {
        "document_id": request.query_params.get("document_id") or "",
        "new_document": request.query_params.get("new") in {"1", "true", "yes"},
        "seeded": request.query_params.get("seeded") in {"1", "true", "yes"},
        "seed": {
            "document_id": request.query_params.get("document_id") or None,
            "source_id": request.query_params.get("seed_source_id") or None,
            "citation_id": request.query_params.get("seed_citation_id") or None,
            "quote_id": request.query_params.get("seed_quote_id") or None,
            "note_id": request.query_params.get("seed_note_id") or None,
            "mode": request.query_params.get("seed_mode") or ("seed_review" if request.query_params.get("seeded") in {"1", "true", "yes"} else None),
        },
    }
    return templates.TemplateResponse(
        request,
        "app_editor.html",
        _shell_context(request=request, page="editor", title="Documents", nav_key="documents", page_state=page_state),
    )


@router.get("/insights", response_class=HTMLResponse)
async def insights(request: Request):
    return templates.TemplateResponse(
        request,
        "app_insights.html",
        _shell_context(request=request, page="insights", title="Insights", nav_key="insights"),
    )
