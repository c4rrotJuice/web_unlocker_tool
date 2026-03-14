import asyncio


from app.routes import citations


class DummyResp:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class OrderedRepo:
    def headers(self, **_kwargs):
        return {"x-test": "1"}

    async def get(self, resource, **kwargs):
        params = kwargs.get("params", {})
        if resource == "citation_instances":
            return DummyResp(
                200,
                [
                    {"id": "c2", "source_id": "s2", "locator": {}, "quote_text": "Second", "excerpt": "Second", "annotation": "", "citation_version": "v2", "created_at": "2026-01-02T00:00:00+00:00"},
                    {"id": "c1", "source_id": "s1", "locator": {}, "quote_text": "First", "excerpt": "First", "annotation": "", "citation_version": "v1", "created_at": "2026-01-01T00:00:00+00:00"},
                ],
            )
        if resource == "sources":
            return DummyResp(
                200,
                [
                    {
                        "id": "s1",
                        "fingerprint": "url:https://example.com/one",
                        "title": "Source One",
                        "source_type": "webpage",
                        "authors": [{"fullName": "Alice Doe", "firstName": "Alice", "lastName": "Doe", "initials": "A", "isOrganization": False}],
                        "container_title": "Example",
                        "publisher": "Example",
                        "issued_date": {"raw": "2024-01-01", "year": 2024},
                        "identifiers": {},
                        "canonical_url": "https://example.com/one",
                        "page_url": "https://example.com/one",
                        "metadata": {"title_case": "Source One", "sentence_case": "Source one", "siteName": "Example", "author": "Alice Doe"},
                        "raw_extraction": {},
                        "normalization_version": 1,
                        "source_version": "sv1",
                    },
                    {
                        "id": "s2",
                        "fingerprint": "url:https://example.com/two",
                        "title": "Source Two",
                        "source_type": "webpage",
                        "authors": [{"fullName": "Bob Doe", "firstName": "Bob", "lastName": "Doe", "initials": "B", "isOrganization": False}],
                        "container_title": "Example",
                        "publisher": "Example",
                        "issued_date": {"raw": "2024-01-02", "year": 2024},
                        "identifiers": {},
                        "canonical_url": "https://example.com/two",
                        "page_url": "https://example.com/two",
                        "metadata": {"title_case": "Source Two", "sentence_case": "Source two", "siteName": "Example", "author": "Bob Doe"},
                        "raw_extraction": {},
                        "normalization_version": 1,
                        "source_version": "sv2",
                    },
                ],
            )
        if resource == "citation_renders":
            return DummyResp(200, [])
        return DummyResp(200, [])


def test_list_citation_records_preserves_requested_id_order(monkeypatch):
    monkeypatch.setattr(citations, "supabase_repo", OrderedRepo())

    records = asyncio.run(citations.list_citation_records("user-1", ids=["c1", "c2"], limit=2))

    assert [record["id"] for record in records] == ["c1", "c2"]
    assert records[0]["full_citation"]
