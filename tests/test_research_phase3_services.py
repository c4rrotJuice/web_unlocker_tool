import pytest
from fastapi import HTTPException

from app.modules.research.citations.service import CitationsService
from app.modules.research.sources.service import SourcesService
from app.modules.research.taxonomy.service import TaxonomyService
from app.services.citation_domain import ExtractionCandidate, ExtractionPayload, build_source_fingerprint


class FakeTaxonomyRepository:
    def __init__(self):
        self.projects = {
            "11111111-1111-1111-1111-111111111111": {
                "id": "11111111-1111-1111-1111-111111111111",
                "user_id": "user-1",
                "name": "Alpha",
                "color": None,
                "description": None,
                "icon": None,
                "status": "active",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        }
        self.tags = {
            "tag-1": {"id": "tag-1", "user_id": "user-1", "name": "Alpha", "created_at": "", "updated_at": ""},
            "tag-2": {"id": "tag-2", "user_id": "user-2", "name": "Foreign", "created_at": "", "updated_at": ""},
        }

    async def list_projects(self, *, user_id, access_token, include_archived):
        return [row for row in self.projects.values() if row["user_id"] == user_id and (include_archived or row["status"] == "active")]

    async def get_project(self, *, user_id, access_token, project_id):
        row = self.projects.get(project_id)
        return row if row and row["user_id"] == user_id else None

    async def create_project(self, *, user_id, access_token, payload):
        row = {
            "id": "project-new",
            "user_id": user_id,
            "name": payload["name"],
            "color": payload.get("color"),
            "description": payload.get("description"),
            "icon": payload.get("icon"),
            "status": "active",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        self.projects[row["id"]] = row
        return row

    async def update_project(self, *, user_id, access_token, project_id, payload):
        row = await self.get_project(user_id=user_id, access_token=access_token, project_id=project_id)
        if row is None:
            return None
        row.update(payload)
        return row

    async def delete_project(self, *, user_id, access_token, project_id):
        row = await self.get_project(user_id=user_id, access_token=access_token, project_id=project_id)
        if row is None:
            return []
        del self.projects[project_id]
        return [{"id": project_id}]

    async def list_tags(self, *, user_id, access_token):
        return [row for row in self.tags.values() if row["user_id"] == user_id]

    async def get_tags_by_ids(self, *, user_id, access_token, tag_ids):
        return [row for row in self.tags.values() if row["user_id"] == user_id and row["id"] in tag_ids]

    async def get_tag_by_name(self, *, user_id, access_token, name):
        for row in self.tags.values():
            if row["user_id"] == user_id and row["name"].lower() == name.lower():
                return row
        return None

    async def create_tag(self, *, user_id, access_token, name):
        row = {"id": f"tag-{len(self.tags) + 1}", "user_id": user_id, "name": name, "created_at": "", "updated_at": ""}
        self.tags[row["id"]] = row
        return row

    async def update_tag(self, *, user_id, access_token, tag_id, name):
        row = self.tags.get(tag_id)
        if not row or row["user_id"] != user_id:
            return None
        row["name"] = name
        return row

    async def delete_tag(self, *, user_id, access_token, tag_id):
        row = self.tags.get(tag_id)
        if not row or row["user_id"] != user_id:
            return []
        del self.tags[tag_id]
        return [{"id": tag_id}]


class FakeSourcesRepository:
    def __init__(self):
        self.by_fingerprint = {}
        self.by_id = {}
        self.citation_counts = {}

    async def get_source_by_fingerprint(self, *, fingerprint):
        return self.by_fingerprint.get(fingerprint)

    async def get_sources_by_ids(self, *, source_ids, access_token):
        return [self.by_id[source_id] for source_id in source_ids if source_id in self.by_id]

    async def create_source(self, payload):
        source_id = f"source-{len(self.by_id) + 1}"
        row = {
            "id": source_id,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            **payload,
        }
        self.by_id[source_id] = row
        self.by_fingerprint[payload["fingerprint"]] = row
        return row

    async def list_visible_sources(self, *, user_id, access_token, source_type, hostname, limit, offset=0):
        rows = list(self.by_id.values())
        if source_type:
            rows = [row for row in rows if row["source_type"] == source_type]
        if hostname:
            rows = [row for row in rows if row.get("hostname") == hostname]
        return rows[offset:offset + limit]

    async def count_citations_for_sources(self, *, user_id, access_token, source_ids):
        return {source_id: self.citation_counts.get(source_id, 0) for source_id in source_ids}


class FakeCitationsRepository:
    def __init__(self):
        self.rows = {}
        self.templates = {}
        self.renders = {}
        self.quote_counts = {}
        self.note_counts = {}
        self.document_counts = {}
        self.list_renders_calls = []
        self.replace_renders_calls = []

    async def create_citation_instance(self, *, user_id, access_token, payload):
        citation_id = f"citation-{len(self.rows) + 1}"
        row = {
            "id": citation_id,
            "user_id": user_id,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            **payload,
        }
        self.rows[citation_id] = row
        return row

    async def get_citation_by_source(self, *, user_id, access_token, source_id):
        for row in self.rows.values():
            if row["user_id"] == user_id and row["source_id"] == source_id:
                return row
        return None

    async def list_citations(self, *, user_id, access_token, citation_ids=None, source_id=None, limit=50, offset=0):
        rows = [row for row in self.rows.values() if row["user_id"] == user_id]
        if citation_ids is not None:
            rows = [row for row in rows if row["id"] in citation_ids]
        if source_id:
            rows = [row for row in rows if row["source_id"] == source_id]
        return rows[offset:offset + limit]

    async def get_citation(self, *, user_id, access_token, citation_id):
        row = self.rows.get(citation_id)
        return row if row and row["user_id"] == user_id else None

    async def update_citation(self, *, user_id, access_token, citation_id, payload):
        row = await self.get_citation(user_id=user_id, access_token=access_token, citation_id=citation_id)
        if row is None:
            return None
        row.update(payload)
        return row

    async def delete_citation(self, *, user_id, access_token, citation_id):
        row = await self.get_citation(user_id=user_id, access_token=access_token, citation_id=citation_id)
        if row is None:
            return []
        del self.rows[citation_id]
        self.renders.pop(citation_id, None)
        return [{"id": citation_id}]

    async def list_renders(self, *, citation_ids, access_token):
        self.list_renders_calls.append(list(citation_ids))
        rows = []
        for citation_id in citation_ids:
            rows.extend(self.renders.get(citation_id, []))
        return rows

    async def replace_renders(self, *, citation_id, source_id, rows):
        self.replace_renders_calls.append(citation_id)
        self.renders[citation_id] = rows

    async def list_quote_counts(self, *, user_id, access_token, citation_ids):
        return {citation_id: self.quote_counts.get(citation_id, 0) for citation_id in citation_ids}

    async def list_note_counts(self, *, user_id, access_token, citation_ids):
        return {citation_id: self.note_counts.get(citation_id, 0) for citation_id in citation_ids}

    async def list_document_counts(self, *, user_id, access_token, citation_ids):
        return {citation_id: self.document_counts.get(citation_id, 0) for citation_id in citation_ids}

    async def list_templates(self, *, user_id, access_token):
        return [row for row in self.templates.values() if row["user_id"] == user_id]

    async def create_template(self, *, user_id, access_token, payload):
        template_id = f"template-{len(self.templates) + 1}"
        row = {"id": template_id, "user_id": user_id, "created_at": "", "updated_at": "", **payload}
        self.templates[template_id] = row
        return row

    async def update_template(self, *, user_id, access_token, template_id, payload):
        row = self.templates.get(template_id)
        if not row or row["user_id"] != user_id:
            return None
        row.update(payload)
        return row

    async def delete_template(self, *, user_id, access_token, template_id):
        row = self.templates.get(template_id)
        if not row or row["user_id"] != user_id:
            return []
        del self.templates[template_id]
        return [{"id": template_id}]


@pytest.fixture
def taxonomy_service():
    return TaxonomyService(repository=FakeTaxonomyRepository())


@pytest.fixture
def sources_service():
    return SourcesService(repository=FakeSourcesRepository())


@pytest.fixture
def citations_service(sources_service):
    return CitationsService(repository=FakeCitationsRepository(), sources_service=sources_service)


def _canonical_extraction_payload(
    *,
    url: str = "https://example.com/paper",
    title: str = "Paper title",
    author: str = "Ada Lovelace",
    excerpt: str = "Quoted sentence",
    quote: str = "Quoted sentence",
    paragraph: int | str = 4,
    date_published: str = "2024-02-03",
) -> ExtractionPayload:
    return ExtractionPayload(
        canonical_url=url,
        page_url=url,
        title_candidates=[ExtractionCandidate(value=title, confidence=1.0)],
        author_candidates=[ExtractionCandidate(value=author, confidence=1.0)],
        date_candidates=[ExtractionCandidate(value=date_published, confidence=1.0)],
        locator={"paragraph": paragraph},
        raw_metadata={
            "quote": quote,
            "excerpt": excerpt,
        },
    )


def test_source_fingerprint_priority_is_deterministic():
    assert build_source_fingerprint({"identifiers": {"doi": "https://doi.org/10.1000/Test"}}) == "doi:10.1000/test"
    assert build_source_fingerprint({"canonical_url": "https://example.com/path#fragment"}) == "url:https://example.com/path"
    digest_fingerprint = build_source_fingerprint(
        {
            "title": "Paper title",
            "authors": [{"fullName": "Ada Lovelace"}],
            "issued": {"raw": "2024"},
            "source_type": "webpage",
        }
    )
    assert digest_fingerprint.startswith("meta:")


@pytest.mark.anyio
async def test_project_ownership_enforced_across_users(taxonomy_service):
    with pytest.raises(HTTPException) as exc:
        await taxonomy_service.get_project(user_id="user-2", access_token=None, project_id="11111111-1111-1111-1111-111111111111")
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_tag_resolve_returns_reusable_canonical_tags(taxonomy_service):
    resolved = await taxonomy_service.resolve_tags(user_id="user-1", access_token=None, names=["Alpha", "Beta", "beta"])
    assert [row["name"] for row in resolved] == ["Alpha", "Beta"]


@pytest.mark.anyio
async def test_source_resolve_deduplicates_same_source_correctly(sources_service):
    first = await sources_service.resolve_or_create_source(
        access_token=None,
        extraction_payload=_canonical_extraction_payload(url="https://doi.org/10.1000/test", title="Paper"),
    )
    second = await sources_service.resolve_or_create_source(
        access_token=None,
        extraction_payload=_canonical_extraction_payload(url="https://doi.org/10.1000/test", title="Paper"),
    )
    assert first["id"] == second["id"]


@pytest.mark.anyio
async def test_source_resolve_rejects_missing_canonical_payload(sources_service):
    with pytest.raises(HTTPException) as exc:
        await sources_service.resolve_or_create_source(access_token=None, extraction_payload=None)
    assert exc.value.status_code == 422


@pytest.mark.anyio
async def test_citation_create_get_list_update_delete_and_shape_are_canonical(citations_service, sources_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(),
        excerpt="Quoted sentence",
        quote="Quoted sentence",
        locator={"paragraph": 4},
        style="mla",
    )
    sources_service.repository.citation_counts[created["source_id"]] = 1
    citations_service.repository.quote_counts[created["id"]] = 2
    citations_service.repository.note_counts[created["id"]] = 1
    citations_service.repository.document_counts[created["id"]] = 3

    loaded = await citations_service.get_citation(user_id="user-1", access_token=None, citation_id=created["id"], account_type="pro")
    listed = (await citations_service.list_citations(user_id="user-1", access_token=None, ids=[created["id"]], limit=1, account_type="pro"))[0]
    rendered = await citations_service.render_citation(user_id="user-1", access_token=None, citation_id=created["id"], style="mla", account_type="pro")

    expected_keys = set(created.keys())
    assert expected_keys == set(loaded.keys()) == set(listed.keys()) == set(rendered.keys())
    assert {"id", "source_id", "source", "renders", "created_at", "updated_at", "relationship_counts"}.issubset(expected_keys)
    assert "mla" in created["renders"]
    assert loaded["relationship_counts"] == {"quote_count": 2, "note_count": 1, "document_count": 3}
    assert listed["relationship_counts"] == {"quote_count": 2, "note_count": 1, "document_count": 3}
    assert rendered["relationship_counts"] == {"quote_count": 2, "note_count": 1, "document_count": 3}

    updated = await citations_service.update_citation(
        user_id="user-1",
        access_token=None,
        citation_id=created["id"],
        payload={"annotation": "Updated", "quote": "Updated quote"},
    )
    assert updated["annotation"] == "Updated"
    assert updated["renders"]["mla"]["bibliography"]

    deleted = await citations_service.delete_citation(user_id="user-1", access_token=None, citation_id=created["id"])
    assert deleted == {"ok": True, "id": created["id"]}


@pytest.mark.anyio
async def test_citation_preview_uses_canonical_rendering_without_persisting_rows(citations_service):
    preview = await citations_service.preview_citation(
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(),
        excerpt="Quoted sentence",
        quote="Quoted sentence",
        locator={"paragraph": 4},
        style="mla",
    )

    assert preview["citation"]["id"] is None
    assert preview["citation"]["source_id"] is None
    assert preview["citation"]["source"]["title"] == "Paper title"
    assert preview["citation"]["renders"]["mla"]["quote_attribution"] == "\"Quoted sentence\" (Lovelace, par. 4)"
    assert preview["render_bundle"]["renders"]["mla"]["quote_attribution"] == "\"Quoted sentence\" (Lovelace, par. 4)"
    assert citations_service.repository.rows == {}
    assert citations_service.repository.renders == {}
    assert citations_service.repository.replace_renders_calls == []


@pytest.mark.anyio
async def test_citation_create_rejects_legacy_metadata_only_payload(citations_service):
    with pytest.raises(HTTPException) as exc:
        await citations_service.create_citation(
            user_id="user-1",
            access_token=None,
            account_type="pro",
            extraction_payload={
                "url": "https://example.com/paper",
                "metadata": {"title": "Paper title", "author": "Ada Lovelace"},
            },
            excerpt="Quoted sentence",
            quote="Quoted sentence",
            locator={"paragraph": 4},
            style="mla",
        )
    assert exc.value.status_code == 422


@pytest.mark.anyio
async def test_citation_create_allows_multiple_contexts_per_user_and_source(citations_service):
    first = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(excerpt="First", quote="First"),
        excerpt="First",
        quote="First",
        style="mla",
    )
    second = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(excerpt="Second", quote="Second"),
        excerpt="Second",
        quote="Second",
        style="mla",
    )

    assert first["id"] != second["id"]
    assert first["source_id"] == second["source_id"]
    assert first["excerpt"] == "First"
    assert second["excerpt"] == "Second"
    assert len(citations_service.repository.rows) == 2


@pytest.mark.anyio
async def test_cross_user_citation_access_is_denied(citations_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(),
        excerpt="Excerpt",
        quote="Excerpt",
        style="mla",
    )
    with pytest.raises(HTTPException) as exc:
        await citations_service.get_citation(user_id="user-2", access_token=None, citation_id=created["id"], account_type="pro")
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_render_cache_populates_and_reuses(citations_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(),
        excerpt="Excerpt",
        quote="Excerpt",
        style="mla",
    )
    render_rows = list(citations_service.repository.renders[created["id"]])
    await citations_service.get_citation(user_id="user-1", access_token=None, citation_id=created["id"], account_type="pro")
    assert citations_service.repository.renders[created["id"]] == render_rows


@pytest.mark.anyio
async def test_stale_render_refresh_rereads_once_for_bulk_hydration(citations_service):
    first = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(url="https://example.com/paper-1", title="Paper 1", excerpt="Excerpt 1", quote="Excerpt 1"),
        excerpt="Excerpt 1",
        quote="Excerpt 1",
        style="mla",
    )
    second = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(url="https://example.com/paper-2", title="Paper 2", excerpt="Excerpt 2", quote="Excerpt 2"),
        excerpt="Excerpt 2",
        quote="Excerpt 2",
        style="mla",
    )
    citations_service.repository.list_renders_calls.clear()
    citations_service.repository.replace_renders_calls.clear()
    citations_service.repository.renders[first["id"]] = []
    citations_service.repository.renders[second["id"]] = []

    rows = await citations_service.list_citations(
        user_id="user-1",
        access_token=None,
        ids=[first["id"], second["id"]],
        limit=2,
        account_type="pro",
    )

    assert [row["id"] for row in rows] == [first["id"], second["id"]]
    assert citations_service.repository.replace_renders_calls == [first["id"], second["id"]]
    assert citations_service.repository.list_renders_calls == [[first["id"], second["id"]], [first["id"], second["id"]]]


@pytest.mark.anyio
async def test_render_endpoint_filters_to_requested_allowed_style_and_reuses_cache(citations_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(),
        excerpt="Excerpt",
        quote="Excerpt",
        style="mla",
    )

    rendered = await citations_service.render_citation(
        user_id="user-1",
        access_token=None,
        citation_id=created["id"],
        style="mla",
        account_type="free",
    )
    assert set(rendered["renders"].keys()) == {"mla"}
    assert rendered["renders"]["mla"]["bibliography"]

    with pytest.raises(HTTPException) as exc:
        await citations_service.render_citation(
            user_id="user-1",
            access_token=None,
            citation_id=created["id"],
            style="chicago",
            account_type="free",
        )
    assert exc.value.status_code == 403


@pytest.mark.anyio
async def test_pro_only_template_behavior_is_enforced(citations_service):
    created = await citations_service.create_template(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        payload={"name": "Custom", "template_body": "{author}", "is_default": False},
    )
    assert created["name"] == "Custom"
    with pytest.raises(HTTPException) as exc:
        await citations_service.list_templates(user_id="user-1", access_token=None, account_type="free")
    assert exc.value.status_code == 403


@pytest.mark.anyio
async def test_research_list_pages_return_cursor_meta_for_sources(sources_service):
    await sources_service.resolve_or_create_source(
        access_token=None,
        extraction_payload=_canonical_extraction_payload(url="https://example.com/1", title="One", excerpt="", quote="", paragraph=1),
    )
    await sources_service.resolve_or_create_source(
        access_token=None,
        extraction_payload=_canonical_extraction_payload(url="https://example.com/2", title="Two", excerpt="", quote="", paragraph=2),
    )
    page = await sources_service.list_sources_page(
        user_id="user-1",
        access_token=None,
        limit=1,
        cursor="0",
    )
    assert len(page["data"]) == 1
    assert page["meta"]["has_more"] is True
    assert page["meta"]["next_cursor"] == "1"


@pytest.mark.anyio
async def test_research_list_pages_return_cursor_meta_for_citations(citations_service):
    first = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(url="https://example.com/paper-1", title="Paper 1", excerpt="Excerpt 1", quote="Excerpt 1"),
        excerpt="Excerpt 1",
        quote="Excerpt 1",
        style="mla",
    )
    second = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_extraction_payload(url="https://example.com/paper-2", title="Paper 2", excerpt="Excerpt 2", quote="Excerpt 2"),
        excerpt="Excerpt 2",
        quote="Excerpt 2",
        style="mla",
    )
    page = await citations_service.list_citations_page(
        user_id="user-1",
        access_token=None,
        limit=1,
        cursor="0",
        account_type="pro",
    )
    assert len(page["data"]) == 1
    assert page["data"][0]["id"] in {first["id"], second["id"]}
    assert page["meta"]["has_more"] is True
    assert page["meta"]["next_cursor"] == "1"
