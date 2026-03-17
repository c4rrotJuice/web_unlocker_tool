from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import RedirectResponse
from supabase import create_client

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.common.ownership import OwnershipValidator
from app.modules.common.relation_validation import RelationValidator
from app.modules.extension.repo import ExtensionRepository
from app.modules.extension.schemas import (
    ExtensionCitationCaptureRequest,
    ExtensionNoteCaptureRequest,
    ExtensionQuoteCaptureRequest,
    ExtensionUsageEventRequest,
    HandoffExchangeRequest,
    HandoffIssueRequest,
    WorkInEditorRequest,
)
from app.modules.extension.service import build_extension_service
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.service import IdentityService
from app.modules.unlock.repo import UnlockRepository
from app.modules.unlock.service import UnlockService
from app.modules.research.citations.repo import CitationsRepository
from app.modules.research.citations.service import CitationsService
from app.modules.research.notes.repo import NotesRepository
from app.modules.research.notes.service import NotesService
from app.modules.research.quotes.repo import QuotesRepository
from app.modules.research.quotes.service import QuotesService
from app.modules.research.sources.repo import SourcesRepository
from app.modules.research.sources.service import SourcesService
from app.modules.research.taxonomy.repo import TaxonomyRepository
from app.modules.research.taxonomy.service import TaxonomyService
from app.modules.workspace.repo import WorkspaceRepository
from app.modules.workspace.service import WorkspaceService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["extension"])
settings = get_settings()
supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
)
identity_service = IdentityService(
    repository=IdentityRepository(
        user_supabase_repo=supabase_repo,
        bootstrap_supabase_repo=supabase_repo,
        anon_key=settings.supabase_anon_key,
    )
)
taxonomy_service = TaxonomyService(
    repository=TaxonomyRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key)
)
sources_service = SourcesService(
    repository=SourcesRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key)
)
citations_service = CitationsService(
    repository=CitationsRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key),
    sources_service=sources_service,
)
notes_repository = NotesRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key)
ownership = OwnershipValidator(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key)
relation_validation = RelationValidator(
    taxonomy_service=taxonomy_service,
    citations_service=citations_service,
    notes_repository=notes_repository,
)
notes_service = NotesService(
    repository=notes_repository,
    taxonomy_service=taxonomy_service,
    citations_service=citations_service,
    ownership=ownership,
    relation_validation=relation_validation,
)
quotes_service = QuotesService(
    repository=QuotesRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key),
    citations_service=citations_service,
    notes_service=notes_service,
    ownership=ownership,
    relation_validation=relation_validation,
)
workspace_service = WorkspaceService(
    repository=WorkspaceRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key),
    taxonomy_service=taxonomy_service,
    citations_service=citations_service,
    notes_service=notes_service,
    ownership=ownership,
    relation_validation=relation_validation,
)
unlock_service = UnlockService(
    repository=UnlockRepository(supabase_repo=supabase_repo),
    contract=str(settings.migration_pack_dir),
)
service = build_extension_service(
    repository=ExtensionRepository(supabase_repo=supabase_repo),
    unlock_service=unlock_service,
    identity_service=identity_service,
    taxonomy_service=taxonomy_service,
    citations_service=citations_service,
    quotes_service=quotes_service,
    notes_service=notes_service,
    workspace_service=workspace_service,
    auth_client=create_client(settings.supabase_url or "", settings.supabase_anon_key or ""),
)


async def _extension_access(
    request: Request,
    auth_context: RequestAuthContext = Depends(require_request_auth_context),
):
    return await service.build_access_context(request, auth_context)


@router.get("/api/extension/status")
async def extension_status() -> dict[str, object]:
    return service.status()


@router.get("/api/extension/bootstrap")
async def extension_bootstrap(access=Depends(_extension_access)):
    return await service.bootstrap(access)


@router.get("/api/extension/taxonomy/recent")
async def extension_recent_taxonomy(access=Depends(_extension_access)):
    return await service.recent_taxonomy(access)


@router.post("/api/auth/handoff")
async def issue_handoff(request: Request, payload: HandoffIssueRequest, access=Depends(_extension_access)):
    return await service.issue_handoff(request, access, payload)


@router.post("/api/auth/handoff/exchange")
async def exchange_handoff(request: Request, payload: HandoffExchangeRequest):
    return await service.exchange_handoff(request, payload)


@router.get("/auth/handoff")
async def handoff_landing(code: str = Query(..., min_length=1)):
    return RedirectResponse(url=service.handoff_redirect_url(code), status_code=307)


@router.post("/api/extension/captures/citation")
async def capture_citation(payload: ExtensionCitationCaptureRequest, access=Depends(_extension_access)):
    return await service.capture_citation(access, payload)


@router.post("/api/extension/captures/quote")
async def capture_quote(payload: ExtensionQuoteCaptureRequest, access=Depends(_extension_access)):
    return await service.capture_quote(access, payload)


@router.post("/api/extension/captures/note")
async def capture_note(payload: ExtensionNoteCaptureRequest, access=Depends(_extension_access)):
    return await service.capture_note(access, payload)


@router.post("/api/extension/work-in-editor")
async def work_in_editor(
    request: Request,
    payload: WorkInEditorRequest,
    access=Depends(_extension_access),
    x_idempotency_key: str | None = Header(default=None),
):
    if x_idempotency_key and not payload.idempotency_key:
        payload.idempotency_key = x_idempotency_key.strip() or None
    return await service.work_in_editor(request, access, payload)


@router.post("/api/extension/usage-events")
async def usage_events(request: Request, payload: ExtensionUsageEventRequest, access=Depends(_extension_access)):
    return await service.record_usage_event(request, access, payload)
