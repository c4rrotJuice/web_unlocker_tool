from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.core.auth import RequestAuthContext, require_request_auth_context
from app.core.config import get_settings
from app.modules.research.citations.repo import CitationsRepository
from app.modules.research.citations.schemas import (
    CitationByIdsRequest,
    CitationCreateRequest,
    CitationPreviewRequest,
    CitationRenderRequest,
    CitationTemplateCreateRequest,
    CitationTemplateUpdateRequest,
    CitationUpdateRequest,
)
from app.modules.research.citations.service import CitationsService
from app.modules.common.ownership import OwnershipValidator
from app.modules.common.relation_validation import RelationValidator
from app.modules.identity.repo import IdentityRepository
from app.modules.identity.service import IdentityService
from app.modules.research.common import load_capability_state_from_request, normalize_uuid
from app.modules.research.graph_service import ResearchGraphService
from app.modules.research.notes.repo import NotesRepository
from app.modules.research.notes.schemas import (
    NoteCreateRequest,
    NoteLinksReplaceRequest,
    NoteSourcesReplaceRequest,
    NoteUpdateRequest,
    TagIdsReplaceRequest as NoteTagIdsReplaceRequest,
)
from app.modules.research.notes.service import NotesService
from app.modules.research.quotes.repo import QuotesRepository
from app.modules.research.quotes.schemas import QuoteCreateRequest, QuoteToNoteRequest, QuoteUpdateRequest
from app.modules.research.quotes.service import QuotesService
from app.modules.research.service import ResearchService
from app.modules.research.sources.repo import SourcesRepository
from app.modules.research.sources.schemas import SourceResolveRequest
from app.modules.research.sources.service import SourcesService
from app.modules.research.taxonomy.repo import TaxonomyRepository
from app.modules.research.taxonomy.schemas import (
    ProjectCreateRequest,
    ProjectUpdateRequest,
    TagCreateRequest,
    TagResolveRequest,
    TagUpdateRequest,
)
from app.modules.research.taxonomy.service import TaxonomyService
from app.modules.workspace.repo import WorkspaceRepository
from app.modules.workspace.service import WorkspaceService
from app.services.supabase_rest import SupabaseRestRepository


router = APIRouter(tags=["research"])
status_router = APIRouter(prefix="/api/research", tags=["research"])
service = ResearchService()
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
workspace_service = WorkspaceService(
    repository=WorkspaceRepository(supabase_repo=supabase_repo, anon_key=settings.supabase_anon_key),
    taxonomy_service=taxonomy_service,
    citations_service=citations_service,
    quotes_service=quotes_service,
    notes_service=notes_service,
    ownership=ownership,
    relation_validation=relation_validation,
)
graph_service = ResearchGraphService(
    sources_service=sources_service,
    citations_service=citations_service,
    quotes_service=quotes_service,
    notes_service=notes_service,
    workspace_service=workspace_service,
    notes_repository=notes_repository,
)


@status_router.get("/status")
async def research_status() -> dict[str, object]:
    return service.status()


async def _access(request: Request, auth_context: RequestAuthContext = Depends(require_request_auth_context)):
    return await load_capability_state_from_request(request, auth_context, identity_service=identity_service)


@router.get("/api/projects")
async def list_projects(
    include_archived: bool = Query(default=True),
    limit: int = Query(default=24, le=100),
    access=Depends(_access),
):
    return await taxonomy_service.list_projects(
        user_id=access.user_id,
        access_token=access.access_token,
        include_archived=include_archived,
        limit=limit,
    )


@router.post("/api/projects")
async def create_project(payload: ProjectCreateRequest, access=Depends(_access)):
    return await taxonomy_service.create_project(
        user_id=access.user_id,
        access_token=access.access_token,
        payload=payload.model_dump(exclude_none=True),
    )


@router.get("/api/projects/{project_id}")
async def get_project(project_id: str, access=Depends(_access)):
    return await taxonomy_service.get_project(
        user_id=access.user_id,
        access_token=access.access_token,
        project_id=project_id,
    )


@router.patch("/api/projects/{project_id}")
async def update_project(project_id: str, payload: ProjectUpdateRequest, access=Depends(_access)):
    return await taxonomy_service.update_project(
        user_id=access.user_id,
        access_token=access.access_token,
        project_id=project_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.post("/api/projects/{project_id}/archive")
async def archive_project(project_id: str, access=Depends(_access)):
    return await taxonomy_service.archive_project(
        user_id=access.user_id,
        access_token=access.access_token,
        project_id=project_id,
    )


@router.post("/api/projects/{project_id}/restore")
async def restore_project(project_id: str, access=Depends(_access)):
    return await taxonomy_service.restore_project(
        user_id=access.user_id,
        access_token=access.access_token,
        project_id=project_id,
    )


@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, access=Depends(_access)):
    return await taxonomy_service.delete_project(
        user_id=access.user_id,
        access_token=access.access_token,
        project_id=project_id,
    )


@router.get("/api/tags")
async def list_tags(access=Depends(_access)):
    return await taxonomy_service.list_tags(user_id=access.user_id, access_token=access.access_token)


@router.post("/api/tags")
async def create_tag(payload: TagCreateRequest, access=Depends(_access)):
    return await taxonomy_service.create_tag(
        user_id=access.user_id,
        access_token=access.access_token,
        name=payload.name,
    )


@router.patch("/api/tags/{tag_id}")
async def update_tag(tag_id: str, payload: TagUpdateRequest, access=Depends(_access)):
    return await taxonomy_service.update_tag(
        user_id=access.user_id,
        access_token=access.access_token,
        tag_id=tag_id,
        name=payload.name,
    )


@router.delete("/api/tags/{tag_id}")
async def delete_tag(tag_id: str, access=Depends(_access)):
    return await taxonomy_service.delete_tag(
        user_id=access.user_id,
        access_token=access.access_token,
        tag_id=tag_id,
    )


@router.post("/api/tags/resolve")
async def resolve_tags(payload: TagResolveRequest, access=Depends(_access)):
    return await taxonomy_service.resolve_tags(
        user_id=access.user_id,
        access_token=access.access_token,
        tag_ids=payload.tag_ids,
        names=payload.names,
    )


@router.get("/api/sources")
async def list_sources(
    query: str | None = None,
    hostname: str | None = None,
    source_type: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, le=100),
    access=Depends(_access),
):
    return await sources_service.list_sources_page(
        user_id=access.user_id,
        access_token=access.access_token,
        query=query,
        hostname=hostname,
        source_type=source_type,
        cursor=cursor,
        limit=limit,
    )


@router.post("/api/sources/resolve")
async def resolve_source(payload: SourceResolveRequest, access=Depends(_access)):
    return await sources_service.resolve_or_create_source(
        access_token=access.access_token,
        extraction_payload=payload.extraction_payload,
    )


@router.get("/api/sources/{source_id}")
async def get_source(source_id: str, access=Depends(_access)):
    normalized_source_id = normalize_uuid(source_id, field_name="source_id")
    return await sources_service.get_source(
        user_id=access.user_id,
        access_token=access.access_token,
        source_id=normalized_source_id,
    )


@router.get("/api/citations")
async def list_citations(
    source_id: str | None = None,
    search: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, le=100),
    access=Depends(_access),
):
    return await citations_service.list_citations_page(
        user_id=access.user_id,
        access_token=access.access_token,
        source_id=source_id,
        search=search,
        cursor=cursor,
        limit=limit,
        account_type=access.capability_state.tier,
    )


@router.post("/api/citations")
async def create_citation(payload: CitationCreateRequest, access=Depends(_access)):
    return await citations_service.create_citation(
        user_id=access.user_id,
        access_token=access.access_token,
        account_type=access.capability_state.tier,
        extraction_payload=payload.extraction_payload,
        excerpt=payload.excerpt,
        locator=payload.locator,
        annotation=payload.annotation,
        quote=payload.quote,
        style=payload.style,
    )


@router.post("/api/citations/preview")
async def preview_citation(payload: CitationPreviewRequest, access=Depends(_access)):
    return await citations_service.preview_citation(
        account_type=access.capability_state.tier,
        extraction_payload=payload.extraction_payload,
        excerpt=payload.excerpt,
        locator=payload.locator,
        annotation=payload.annotation,
        quote=payload.quote,
        style=payload.style,
    )


@router.get("/api/citations/{citation_id}")
async def get_citation(citation_id: str, access=Depends(_access)):
    return await citations_service.get_citation(
        user_id=access.user_id,
        access_token=access.access_token,
        citation_id=normalize_uuid(citation_id, field_name="citation_id"),
        account_type=access.capability_state.tier,
    )


@router.patch("/api/citations/{citation_id}")
async def update_citation(citation_id: str, payload: CitationUpdateRequest, access=Depends(_access)):
    return await citations_service.update_citation(
        user_id=access.user_id,
        access_token=access.access_token,
        citation_id=normalize_uuid(citation_id, field_name="citation_id"),
        payload=payload.model_dump(exclude_none=True),
    )


@router.delete("/api/citations/{citation_id}")
async def delete_citation(citation_id: str, access=Depends(_access)):
    return await citations_service.delete_citation(
        user_id=access.user_id,
        access_token=access.access_token,
        citation_id=normalize_uuid(citation_id, field_name="citation_id"),
    )


@router.get("/api/quotes")
async def list_quotes(
    citation_id: str | None = None,
    document_id: str | None = None,
    project_id: str | None = None,
    query: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, le=100),
    access=Depends(_access),
):
    return await quotes_service.list_quotes_page(
        user_id=access.user_id,
        access_token=access.access_token,
        citation_id=citation_id,
        document_id=document_id,
        project_id=project_id,
        query=query,
        cursor=cursor,
        limit=limit,
    )


@router.post("/api/quotes")
async def create_quote(payload: QuoteCreateRequest, access=Depends(_access)):
    return await quotes_service.create_quote(
        user_id=access.user_id,
        access_token=access.access_token,
        payload=payload.model_dump(exclude_none=True),
    )


@router.get("/api/quotes/{quote_id}")
async def get_quote(quote_id: str, access=Depends(_access)):
    return await quotes_service.get_quote(
        user_id=access.user_id,
        access_token=access.access_token,
        quote_id=quote_id,
    )


@router.patch("/api/quotes/{quote_id}")
async def update_quote(quote_id: str, payload: QuoteUpdateRequest, access=Depends(_access)):
    return await quotes_service.update_quote(
        user_id=access.user_id,
        access_token=access.access_token,
        quote_id=quote_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.delete("/api/quotes/{quote_id}")
async def delete_quote(quote_id: str, access=Depends(_access)):
    return await quotes_service.delete_quote(
        user_id=access.user_id,
        access_token=access.access_token,
        quote_id=quote_id,
    )


@router.post("/api/quotes/{quote_id}/notes")
async def create_note_from_quote(quote_id: str, payload: QuoteToNoteRequest, access=Depends(_access)):
    return await quotes_service.create_note_from_quote(
        user_id=access.user_id,
        access_token=access.access_token,
        quote_id=quote_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.get("/api/notes")
async def list_notes(
    project_id: str | None = None,
    tag_id: str | None = None,
    citation_id: str | None = None,
    quote_id: str | None = None,
    status: str | None = None,
    query: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, le=100),
    access=Depends(_access),
):
    return await notes_service.list_notes_page(
        user_id=access.user_id,
        access_token=access.access_token,
        project_id=project_id,
        tag_id=tag_id,
        citation_id=citation_id,
        quote_id=quote_id,
        status=status,
        query=query,
        cursor=cursor,
        limit=limit,
    )


@router.post("/api/notes")
async def create_note(payload: NoteCreateRequest, access=Depends(_access)):
    return await notes_service.create_note(
        user_id=access.user_id,
        access_token=access.access_token,
        payload=payload.model_dump(exclude_none=True),
    )


@router.get("/api/notes/{note_id}")
async def get_note(note_id: str, access=Depends(_access)):
    return await notes_service.get_note(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
    )


@router.get("/api/research/{entity}/{entity_id}/graph")
async def get_research_graph(entity: str, entity_id: str, access=Depends(_access)):
    return await graph_service.get_graph(
        user_id=access.user_id,
        access_token=access.access_token,
        capability_state=access.capability_state,
        entity=entity,
        entity_id=entity_id,
    )


@router.patch("/api/notes/{note_id}")
async def update_note(note_id: str, payload: NoteUpdateRequest, access=Depends(_access)):
    return await notes_service.update_note(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
        payload=payload.model_dump(exclude_none=True),
    )


@router.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, access=Depends(_access)):
    return await notes_service.delete_note(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
    )


@router.post("/api/notes/{note_id}/archive")
async def archive_note(note_id: str, access=Depends(_access)):
    return await notes_service.archive_note(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
    )


@router.post("/api/notes/{note_id}/restore")
async def restore_note(note_id: str, access=Depends(_access)):
    return await notes_service.restore_note(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
    )


@router.put("/api/notes/{note_id}/tags")
async def replace_note_tags(note_id: str, payload: NoteTagIdsReplaceRequest, access=Depends(_access)):
    return await notes_service.replace_note_tags(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
        tag_ids=payload.tag_ids,
    )


@router.put("/api/notes/{note_id}/sources")
async def replace_note_sources(note_id: str, payload: NoteSourcesReplaceRequest, access=Depends(_access)):
    return await notes_service.replace_note_sources(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
        sources=[item.model_dump(exclude_none=True) for item in payload.sources],
    )


@router.put("/api/notes/{note_id}/links")
async def replace_note_links(note_id: str, payload: NoteLinksReplaceRequest, access=Depends(_access)):
    return await notes_service.replace_note_links(
        user_id=access.user_id,
        access_token=access.access_token,
        note_id=note_id,
        linked_note_ids=payload.linked_note_ids,
    )


@router.post("/api/citations/render")
async def render_citation(payload: CitationRenderRequest, access=Depends(_access)):
    return await citations_service.render_citation(
        user_id=access.user_id,
        access_token=access.access_token,
        citation_id=normalize_uuid(payload.citation_id, field_name="citation_id"),
        style=payload.style,
        account_type=access.capability_state.tier,
    )


@router.post("/api/citations/by-ids")
async def citations_by_ids(payload: CitationByIdsRequest, access=Depends(_access)):
    return await citations_service.list_citations(
        user_id=access.user_id,
        access_token=access.access_token,
        ids=[normalize_uuid(citation_id, field_name="citation_id") for citation_id in payload.ids],
        limit=min(len(payload.ids) or 1, 100),
        account_type=access.capability_state.tier,
    )


@router.get("/api/citation-templates")
async def list_citation_templates(access=Depends(_access)):
    return await citations_service.list_templates(
        user_id=access.user_id,
        access_token=access.access_token,
        account_type=access.capability_state.tier,
    )


@router.post("/api/citation-templates")
async def create_citation_template(payload: CitationTemplateCreateRequest, access=Depends(_access)):
    return await citations_service.create_template(
        user_id=access.user_id,
        access_token=access.access_token,
        account_type=access.capability_state.tier,
        payload=payload.model_dump(exclude_none=True),
    )


@router.put("/api/citation-templates/{template_id}")
async def update_citation_template(template_id: str, payload: CitationTemplateUpdateRequest, access=Depends(_access)):
    return await citations_service.update_template(
        user_id=access.user_id,
        access_token=access.access_token,
        account_type=access.capability_state.tier,
        template_id=normalize_uuid(template_id, field_name="template_id"),
        payload=payload.model_dump(exclude_none=True),
    )


@router.delete("/api/citation-templates/{template_id}")
async def delete_citation_template(template_id: str, access=Depends(_access)):
    return await citations_service.delete_template(
        user_id=access.user_id,
        access_token=access.access_token,
        account_type=access.capability_state.tier,
        template_id=normalize_uuid(template_id, field_name="template_id"),
    )
