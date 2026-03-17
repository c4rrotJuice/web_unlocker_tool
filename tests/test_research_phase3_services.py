import pytest
from fastapi import HTTPException

from app.modules.research.citations.service import CitationsService
from app.modules.research.sources.service import SourcesService
from app.modules.research.taxonomy.service import TaxonomyService
from app.services.citation_domain import build_source_fingerprint


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

    async def list_visible_sources(self, *, user_id, access_token, source_type, hostname, limit):
        rows = list(self.by_id.values())
        if source_type:
            rows = [row for row in rows if row["source_type"] == source_type]
        if hostname:
            rows = [row for row in rows if row.get("hostname") == hostname]
        return rows[:limit]

    async def count_citations_for_sources(self, *, user_id, access_token, source_ids):
        return {source_id: self.citation_counts.get(source_id, 0) for source_id in source_ids}


class FakeCitationsRepository:
    def __init__(self):
        self.rows = {}
        self.templates = {}
        self.renders = {}
        self.quote_counts = {}
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

    async def list_citations(self, *, user_id, access_token, citation_ids=None, source_id=None, limit=50):
        rows = [row for row in self.rows.values() if row["user_id"] == user_id]
        if citation_ids is not None:
            rows = [row for row in rows if row["id"] in citation_ids]
        if source_id:
            rows = [row for row in rows if row["source_id"] == source_id]
        return rows[:limit]

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
        extraction_payload=None,
        url="https://doi.org/10.1000/test",
        metadata={"doi": "10.1000/test", "title": "Paper"},
        excerpt="Excerpt",
        quote="Excerpt",
        locator={},
    )
    second = await sources_service.resolve_or_create_source(
        access_token=None,
        extraction_payload=None,
        url="https://doi.org/10.1000/test",
        metadata={"doi": "10.1000/test", "title": "Paper"},
        excerpt="Excerpt",
        quote="Excerpt",
        locator={},
    )
    assert first["id"] == second["id"]


@pytest.mark.anyio
async def test_citation_create_get_list_update_delete_and_shape_are_canonical(citations_service, sources_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        payload={
            "url": "https://example.com/paper",
            "metadata": {"title": "Paper title", "author": "Ada Lovelace", "datePublished": "2024-02-03"},
            "excerpt": "Quoted sentence",
            "quote": "Quoted sentence",
            "locator": {"paragraph": 4},
            "style": "mla",
        },
    )
    sources_service.repository.citation_counts[created["source_id"]] = 1
    citations_service.repository.quote_counts[created["id"]] = 2

    loaded = await citations_service.get_citation(user_id="user-1", access_token=None, citation_id=created["id"])
    listed = (await citations_service.list_citations(user_id="user-1", access_token=None, ids=[created["id"]], limit=1))[0]
    rendered = await citations_service.render_citation(user_id="user-1", access_token=None, citation_id=created["id"], style="mla")

    expected_keys = set(created.keys())
    assert expected_keys == set(loaded.keys()) == set(listed.keys()) == set(rendered.keys())
    assert {"id", "source_id", "source", "renders", "created_at", "updated_at", "relationship_counts"}.issubset(expected_keys)
    assert "mla" in created["renders"]

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
async def test_cross_user_citation_access_is_denied(citations_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        payload={"url": "https://example.com/paper", "metadata": {"title": "Paper"}, "excerpt": "Excerpt", "quote": "Excerpt", "style": "mla"},
    )
    with pytest.raises(HTTPException) as exc:
        await citations_service.get_citation(user_id="user-2", access_token=None, citation_id=created["id"])
    assert exc.value.status_code == 404


@pytest.mark.anyio
async def test_render_cache_populates_and_reuses(citations_service):
    created = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        payload={"url": "https://example.com/paper", "metadata": {"title": "Paper"}, "excerpt": "Excerpt", "quote": "Excerpt", "style": "mla"},
    )
    render_rows = list(citations_service.repository.renders[created["id"]])
    await citations_service.get_citation(user_id="user-1", access_token=None, citation_id=created["id"])
    assert citations_service.repository.renders[created["id"]] == render_rows


@pytest.mark.anyio
async def test_stale_render_refresh_rereads_once_for_bulk_hydration(citations_service):
    first = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        payload={"url": "https://example.com/paper-1", "metadata": {"title": "Paper 1"}, "excerpt": "Excerpt 1", "quote": "Excerpt 1", "style": "mla"},
    )
    second = await citations_service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        payload={"url": "https://example.com/paper-2", "metadata": {"title": "Paper 2"}, "excerpt": "Excerpt 2", "quote": "Excerpt 2", "style": "mla"},
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
    )

    assert [row["id"] for row in rows] == [first["id"], second["id"]]
    assert citations_service.repository.replace_renders_calls == [first["id"], second["id"]]
    assert citations_service.repository.list_renders_calls == [[first["id"], second["id"]], [first["id"], second["id"]]]


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
