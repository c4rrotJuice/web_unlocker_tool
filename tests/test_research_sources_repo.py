import pytest

from app.modules.research.sources.repo import SourcesRepository


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def json(self):
        return self._payload


class FakeSupabaseRepo:
    def __init__(self):
        self.citation_rows = [
            {"source_id": "source-citation", "created_at": "2026-01-03T00:00:00+00:00"},
        ]
        self.note_source_rows = [
            {"source_id": "source-note", "attached_at": "2026-01-04T00:00:00+00:00"},
        ]
        self.sources = {
            "source-citation": {"id": "source-citation", "title": "Citation-backed", "hostname": "example.com", "source_type": "webpage"},
            "source-note": {"id": "source-note", "title": "Note-backed", "hostname": "example.com", "source_type": "webpage"},
        }

    def headers(self, **kwargs):
        del kwargs
        return {}

    async def get(self, table, params=None, headers=None):
        del headers
        params = params or {}
        if table == "citation_instances":
            offset = int(params.get("offset", "0"))
            limit = int(params.get("limit", "100"))
            return FakeResponse(self.citation_rows[offset:offset + limit])
        if table == "note_sources":
            offset = int(params.get("offset", "0"))
            limit = int(params.get("limit", "100"))
            rows = [row for row in self.note_source_rows if row.get("source_id")]
            return FakeResponse(rows[offset:offset + limit])
        if table == "sources":
            raw_ids = str(params.get("id", "in.()"))[4:-1]
            ids = [item for item in raw_ids.split(",") if item]
            rows = [self.sources[source_id] for source_id in ids if source_id in self.sources]
            return FakeResponse(rows)
        raise AssertionError(f"unexpected table {table}")


@pytest.mark.anyio
async def test_visible_sources_include_note_linked_sources_not_just_citation_instances():
    repository = SourcesRepository(supabase_repo=FakeSupabaseRepo(), anon_key=None)
    rows = await repository.list_visible_sources(
        user_id="user-1",
        access_token=None,
        source_type=None,
        hostname=None,
        limit=10,
        offset=0,
    )
    ids = [row["id"] for row in rows]
    assert ids == ["source-note", "source-citation"]
