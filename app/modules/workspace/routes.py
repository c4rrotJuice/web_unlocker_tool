from fastapi import APIRouter, Depends, Query, Request

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.common.ownership import OwnershipValidator
from app.modules.common.relation_validation import RelationValidator
from app.modules.research.citations.repo import CitationsRepository
from app.modules.research.citations.service import CitationsService
from app.modules.research.common import load_capability_state_from_request
from app.modules.research.notes.repo import NotesRepository
from app.modules.research.notes.service import NotesService
from app.modules.research.quotes.repo import QuotesRepository
from app.modules.research.quotes.service import QuotesService
from app.modules.research.sources.repo import SourcesRepository
from app.modules.research.sources.service import SourcesService
from app.modules.research.taxonomy.repo import TaxonomyRepository
from app.modules.research.taxonomy.service import TaxonomyService
from app.modules.workspace.schemas import (
    CheckpointCreateRequest,
    CitationIdsReplaceRequest,
    DocumentCreateRequest,
    DocumentUpdateRequest,
    NoteIdsReplaceRequest,
    TagIdsReplaceRequest,
)
from app.modules.workspace.repo import WorkspaceRepository

from app.modules.workspace.service import WorkspaceService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["workspace"])
status_router = APIRouter(prefix="/api/workspace", tags=["workspace"])
settings = get_settings()
supabase_repo = SupabaseRestRepository(
    base_url=settings.supabase_url,
    service_role_key=settings.supabase_service_role_key,
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
    sources_service=sources_service,
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
service = WorkspaceService(
    repository=WorkspaceRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key),
    taxonomy_service=taxonomy_service,
    citations_service=citations_service,
    quotes_service=quotes_service,
    notes_service=notes_service,
    ownership=ownership,
    relation_validation=relation_validation,
)


@status_router.get("/status")
async def workspace_status() -> dict[str, object]:
    return service.status()


async def _access(request: Request, auth_context: RequestAuthContext = Depends(require_request_auth_context)):
    return await load_capability_state_from_request(request, auth_context)


@router.get("/api/editor/access")
async def editor_access(access=Depends(_access)):
    return {
        "ok": True,
        "data": {
            "capabilities": access.capability_state.capabilities,
            "limits": {
                "can_create_document": True,
                "can_edit_existing": True,
            },
        },
        "meta": {},
        "error": None,
    }


@router.get("/api/docs")
async def list_documents(
    project_id: str | None = None,
    status: str | None = None,
    view: str | None = None,
    limit: int = Query(default=50, le=100),
    access=Depends(_access),
):
    return await service.list_documents(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        project_id=project_id,
        status=status,
        limit=limit,
        summary_only=(view or "").strip().lower() == "summary",
    )


@router.post("/api/docs")
async def create_document(payload: DocumentCreateRequest, access=Depends(_access)):
    return await service.create_document(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        payload=payload.model_dump(exclude_none=True),
    )


@router.get("/api/docs/{document_id}")
async def get_document(document_id: str, access=Depends(_access)):
    return await service.get_document(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
    )


@router.patch("/api/docs/{document_id}")
async def update_document(document_id: str, payload: DocumentUpdateRequest, access=Depends(_access)):
    return await service.update_document(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.delete("/api/docs/{document_id}")
async def delete_document(document_id: str, access=Depends(_access)):
    return await service.delete_document(
        user_id=access.user_id,
        access_token=access.access_token,
        document_id=document_id,
    )


@router.post("/api/docs/{document_id}/archive")
async def archive_document(document_id: str, access=Depends(_access)):
    return await service.archive_document(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
    )


@router.post("/api/docs/{document_id}/restore")
async def restore_document(document_id: str, access=Depends(_access)):
    return await service.restore_document(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
    )


@router.put("/api/docs/{document_id}/citations")
async def replace_document_citations(document_id: str, payload: CitationIdsReplaceRequest, access=Depends(_access)):
    return await service.replace_document_citations(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
        revision=payload.revision,
        citation_ids=payload.citation_ids,
    )


@router.put("/api/docs/{document_id}/notes")
async def replace_document_notes(document_id: str, payload: NoteIdsReplaceRequest, access=Depends(_access)):
    return await service.replace_document_notes(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
        revision=payload.revision,
        note_ids=payload.note_ids,
    )


@router.put("/api/docs/{document_id}/tags")
async def replace_document_tags(document_id: str, payload: TagIdsReplaceRequest, access=Depends(_access)):
    return await service.replace_document_tags(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
        revision=payload.revision,
        tag_ids=payload.tag_ids,
    )


@router.get("/api/docs/{document_id}/checkpoints")
async def list_document_checkpoints(document_id: str, limit: int = Query(default=10, le=20), access=Depends(_access)):
    return await service.list_checkpoints(
        user_id=access.user_id,
        access_token=access.access_token,
        document_id=document_id,
        limit=limit,
    )


@router.post("/api/docs/{document_id}/checkpoints")
async def create_document_checkpoint(document_id: str, payload: CheckpointCreateRequest, access=Depends(_access)):
    return await service.create_checkpoint(
        user_id=access.user_id,
        access_token=access.access_token,
        document_id=document_id,
        label=payload.label,
    )


@router.post("/api/docs/{document_id}/checkpoints/{checkpoint_id}/restore")
async def restore_document_checkpoint(document_id: str, checkpoint_id: str, revision: str = Query(...), access=Depends(_access)):
    return await service.restore_checkpoint(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
        checkpoint_id=checkpoint_id,
        revision=revision,
    )


@router.get("/api/docs/{document_id}/hydrate")
async def hydrate_document(
    document_id: str,
    seed_source_id: str | None = None,
    seed_citation_id: str | None = None,
    seed_quote_id: str | None = None,
    seed_note_id: str | None = None,
    seed_mode: str | None = None,
    access=Depends(_access),
):
    return await service.hydrate_document(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        document_id=document_id,
        seed={
            "document_id": document_id,
            "source_id": seed_source_id,
            "citation_id": seed_citation_id,
            "quote_id": seed_quote_id,
            "note_id": seed_note_id,
            "mode": seed_mode or "seed_review",
        } if any([seed_source_id, seed_citation_id, seed_quote_id, seed_note_id]) else None,
    )


@router.get("/api/docs/{document_id}/outline")
async def document_outline(document_id: str, access=Depends(_access)):
    return await service.outline_document(
        user_id=access.user_id,
        access_token=access.access_token,
        document_id=document_id,
    )
