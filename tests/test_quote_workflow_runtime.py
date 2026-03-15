import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routes import citations
from app.services import research_entities


USER_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_USER_ID = "22222222-2222-2222-2222-222222222222"
DOCUMENT_ID = "12345678-1234-4234-8234-123456789abc"
PROJECT_ID = "abcdefab-cdef-4def-8def-abcdefabcdef"

CITATION_ALPHA = "11111111-2222-4333-8444-555555555555"
CITATION_BETA = "66666666-7777-4888-8999-aaaaaaaaaaaa"
CITATION_GAMMA = "77777777-8888-4999-8aaa-bbbbbbbbbbbb"
CITATION_DELTA = "88888888-9999-4aaa-8bbb-cccccccccccc"
CITATION_FOREIGN = "bbbbbbbb-1111-4222-8333-cccccccccccc"

QUOTE_ALPHA_LATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
QUOTE_BETA_EARLY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
QUOTE_ALPHA_EARLY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
QUOTE_GAMMA_ONLY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
QUOTE_DELTA_UNATTACHED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
QUOTE_FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffffff"
QUOTE_MISSING = "abababab-abab-4bab-8bab-abababababab"


class DummyResp:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def _shared_citation_payload(citation_id: str) -> dict:
    suffix = citation_id[-4:]
    return {
        "id": citation_id,
        "format": "mla",
        "excerpt": f"Excerpt for {suffix}",
        "quote": f"Quoted sentence {suffix}",
        "full_citation": f"Full citation {suffix}",
        "inline_citation": f"(Author {suffix})",
        "footnote": f"Footnote {suffix}",
        "quote_attribution": f'"Quoted sentence {suffix}" (Author {suffix})',
        "url": f"https://example.com/{citation_id}",
        "metadata": {"locator": {"page": int(suffix, 16) % 10 + 1}},
        "source": {
            "id": f"source-{suffix}",
            "title": f"Source {suffix}",
            "publisher": "Example Press",
            "canonical_url": f"https://canonical.example/{suffix}",
        },
    }


class QuoteWorkflowRepo:
    def __init__(self):
        self.quotes = {
            QUOTE_ALPHA_LATE: {
                "id": QUOTE_ALPHA_LATE,
                "citation_id": CITATION_ALPHA,
                "user_id": USER_ID,
                "excerpt": "Alpha late quote excerpt",
                "locator": {"page": 4},
                "annotation": "Alpha annotation",
                "created_at": "2026-01-03T00:00:00+00:00",
                "updated_at": "2026-01-03T00:00:00+00:00",
            },
            QUOTE_BETA_EARLY: {
                "id": QUOTE_BETA_EARLY,
                "citation_id": CITATION_BETA,
                "user_id": USER_ID,
                "excerpt": "Beta quote excerpt",
                "locator": {"page": 2},
                "annotation": None,
                "created_at": "2026-01-01T06:00:00+00:00",
                "updated_at": "2026-01-01T06:00:00+00:00",
            },
            QUOTE_ALPHA_EARLY: {
                "id": QUOTE_ALPHA_EARLY,
                "citation_id": CITATION_ALPHA,
                "user_id": USER_ID,
                "excerpt": "Alpha early quote excerpt",
                "locator": {"page": 3},
                "annotation": None,
                "created_at": "2026-01-01T05:00:00+00:00",
                "updated_at": "2026-01-01T05:00:00+00:00",
            },
            QUOTE_GAMMA_ONLY: {
                "id": QUOTE_GAMMA_ONLY,
                "citation_id": CITATION_GAMMA,
                "user_id": USER_ID,
                "excerpt": "Gamma quote excerpt",
                "locator": {"page": 7},
                "annotation": None,
                "created_at": "2026-01-02T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            },
            QUOTE_DELTA_UNATTACHED: {
                "id": QUOTE_DELTA_UNATTACHED,
                "citation_id": CITATION_DELTA,
                "user_id": USER_ID,
                "excerpt": "Delta unattached quote excerpt",
                "locator": {"page": 8},
                "annotation": None,
                "created_at": "2026-01-04T00:00:00+00:00",
                "updated_at": "2026-01-04T00:00:00+00:00",
            },
            QUOTE_FOREIGN: {
                "id": QUOTE_FOREIGN,
                "citation_id": CITATION_FOREIGN,
                "user_id": FOREIGN_USER_ID,
                "excerpt": "Foreign quote excerpt",
                "locator": {"page": 9},
                "annotation": None,
                "created_at": "2026-01-05T00:00:00+00:00",
                "updated_at": "2026-01-05T00:00:00+00:00",
            },
        }
        self.notes = {
            "99999999-0000-4000-8000-000000000001": {
                "id": "99999999-0000-4000-8000-000000000001",
                "quote_id": QUOTE_ALPHA_LATE,
                "citation_id": CITATION_ALPHA,
                "user_id": USER_ID,
                "created_at": "2026-01-05T00:00:00+00:00",
            },
            "99999999-0000-4000-8000-000000000002": {
                "id": "99999999-0000-4000-8000-000000000002",
                "quote_id": QUOTE_ALPHA_LATE,
                "citation_id": CITATION_ALPHA,
                "user_id": USER_ID,
                "created_at": "2026-01-06T00:00:00+00:00",
            },
            "99999999-0000-4000-8000-000000000003": {
                "id": "99999999-0000-4000-8000-000000000003",
                "quote_id": None,
                "citation_id": CITATION_ALPHA,
                "user_id": USER_ID,
                "created_at": "2026-01-07T00:00:00+00:00",
            },
        }
        self.citation_instances = {
            CITATION_ALPHA: {"id": CITATION_ALPHA, "user_id": USER_ID},
            CITATION_BETA: {"id": CITATION_BETA, "user_id": USER_ID},
            CITATION_GAMMA: {"id": CITATION_GAMMA, "user_id": USER_ID},
            CITATION_DELTA: {"id": CITATION_DELTA, "user_id": USER_ID},
            CITATION_FOREIGN: {"id": CITATION_FOREIGN, "user_id": FOREIGN_USER_ID},
        }
        self.document_citations = [
            {
                "document_id": DOCUMENT_ID,
                "citation_id": CITATION_ALPHA,
                "user_id": USER_ID,
                "attached_at": "2026-01-10T00:00:00+00:00",
            },
            {
                "document_id": DOCUMENT_ID,
                "citation_id": CITATION_BETA,
                "user_id": USER_ID,
                "attached_at": "2026-01-10T00:00:00+00:00",
            },
            {
                "document_id": DOCUMENT_ID,
                "citation_id": CITATION_GAMMA,
                "user_id": USER_ID,
                "attached_at": "2026-01-11T00:00:00+00:00",
            },
        ]
        self.projects = {
            PROJECT_ID: {"id": PROJECT_ID, "user_id": USER_ID},
        }
        self.tags = {}
        self.calls = []
        self.rpc_calls = []

    def headers(self, **_kwargs):
        return {}

    async def get(self, resource, **kwargs):
        self.calls.append(("get", resource, deepcopy(kwargs)))
        params = kwargs.get("params", {})
        if resource == "quotes":
            return DummyResp(200, self._quote_rows(params))
        if resource == "notes":
            return DummyResp(200, self._note_rows(params))
        if resource == "citation_instances":
            return DummyResp(200, self._citation_rows(params))
        if resource == "document_citations":
            return DummyResp(200, self._document_citation_rows(params))
        if resource == "projects":
            return DummyResp(200, self._project_rows(params))
        if resource == "tags":
            return DummyResp(200, self._tag_rows(params))
        if resource == "note_tag_links":
            return DummyResp(200, [])
        return DummyResp(200, [])

    async def post(self, resource, **kwargs):
        self.calls.append(("post", resource, deepcopy(kwargs)))
        payload = deepcopy(kwargs.get("json") or {})
        if resource == "quotes":
            quote_id = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0"
            stored = {
                "id": quote_id,
                "citation_id": payload["citation_id"],
                "user_id": payload["user_id"],
                "excerpt": payload["excerpt"],
                "locator": payload["locator"],
                "annotation": payload["annotation"],
                "created_at": payload["created_at"],
                "updated_at": payload["updated_at"],
            }
            self.quotes[quote_id] = stored
            return DummyResp(201, [deepcopy(stored)])
        if resource == "notes":
            self.notes[payload["id"]] = {
                "id": payload["id"],
                "quote_id": payload["quote_id"],
                "citation_id": payload["citation_id"],
                "user_id": payload["user_id"],
                "created_at": payload["created_at"],
                "title": payload["title"],
                "highlight_text": payload["highlight_text"],
                "note_body": payload["note_body"],
                "project_id": payload["project_id"],
            }
            return DummyResp(201, [deepcopy(self.notes[payload["id"]])])
        if resource == "tags":
            tag_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
            stored = {"id": tag_id, "name": payload.get("name"), "user_id": USER_ID}
            self.tags[tag_id] = stored
            return DummyResp(201, [deepcopy(stored)])
        return DummyResp(201, [])

    async def delete(self, resource, **kwargs):
        self.calls.append(("delete", resource, deepcopy(kwargs)))
        return DummyResp(204, [])

    async def patch(self, resource, **kwargs):
        self.calls.append(("patch", resource, deepcopy(kwargs)))
        return DummyResp(200, [])

    async def rpc(self, function_name, **kwargs):
        payload = deepcopy(kwargs.get("json") or {})
        self.rpc_calls.append((function_name, payload))
        if function_name == "replace_note_tag_links_atomic":
            return DummyResp(200, payload.get("p_tag_ids", []))
        return DummyResp(404, {"message": f'function "{function_name}" does not exist'})

    def _quote_rows(self, params):
        rows = [deepcopy(row) for row in self.quotes.values()]
        user_id = params.get("user_id", "").replace("eq.", "")
        if user_id:
            rows = [row for row in rows if row["user_id"] == user_id]
        quote_id_filter = params.get("id", "")
        if quote_id_filter.startswith("eq."):
            target_id = quote_id_filter.replace("eq.", "")
            rows = [row for row in rows if row["id"] == target_id]
        elif quote_id_filter.startswith("in.("):
            allowed = {item.strip() for item in quote_id_filter[4:-1].split(",") if item.strip()}
            rows = [row for row in rows if row["id"] in allowed]
        citation_filter = params.get("citation_id", "")
        if citation_filter.startswith("eq."):
            target_citation = citation_filter.replace("eq.", "")
            rows = [row for row in rows if row["citation_id"] == target_citation]
        elif citation_filter.startswith("in.("):
            allowed_citations = {item.strip() for item in citation_filter[4:-1].split(",") if item.strip()}
            rows = [row for row in rows if row["citation_id"] in allowed_citations]
        order = params.get("order", "")
        if order == "created_at.desc":
            rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
        limit = params.get("limit")
        offset = params.get("offset")
        if limit is not None or offset is not None:
            normalized_offset = int(offset or 0)
            normalized_limit = int(limit or len(rows))
            rows = rows[normalized_offset:normalized_offset + normalized_limit]
        return rows

    def _note_rows(self, params):
        rows = [deepcopy(row) for row in self.notes.values()]
        user_id = params.get("user_id", "").replace("eq.", "")
        if user_id:
            rows = [row for row in rows if row["user_id"] == user_id]
        quote_filter = params.get("quote_id", "")
        if quote_filter.startswith("in.("):
            allowed_quotes = {item.strip() for item in quote_filter[4:-1].split(",") if item.strip()}
            rows = [row for row in rows if row.get("quote_id") in allowed_quotes]
        rows.sort(key=lambda row: (row.get("created_at") or "", row["id"]))
        return rows

    def _citation_rows(self, params):
        rows = [deepcopy(row) for row in self.citation_instances.values()]
        ids_filter = params.get("id", "")
        if ids_filter.startswith("in.("):
            allowed = {item.strip() for item in ids_filter[4:-1].split(",") if item.strip()}
            rows = [row for row in rows if row["id"] in allowed]
        return rows

    def _document_citation_rows(self, params):
        rows = [deepcopy(row) for row in self.document_citations]
        user_id = params.get("user_id", "").replace("eq.", "")
        if user_id:
            rows = [row for row in rows if row["user_id"] == user_id]
        document_filter = params.get("document_id", "")
        if document_filter.startswith("eq."):
            target_doc = document_filter.replace("eq.", "")
            rows = [row for row in rows if row["document_id"] == target_doc]
        rows.sort(key=lambda row: (row["attached_at"], row["citation_id"]))
        return rows

    def _project_rows(self, params):
        rows = [deepcopy(row) for row in self.projects.values()]
        project_id = params.get("id", "").replace("eq.", "")
        user_id = params.get("user_id", "").replace("eq.", "")
        return [row for row in rows if row["id"] == project_id and row["user_id"] == user_id]

    def _tag_rows(self, params):
        rows = [deepcopy(row) for row in self.tags.values()]
        user_id = params.get("user_id", "").replace("eq.", "")
        if user_id:
            rows = [row for row in rows if row["user_id"] == user_id]
        tag_id_filter = params.get("id", "")
        if tag_id_filter.startswith("in.("):
            allowed = {item.strip() for item in tag_id_filter[4:-1].split(",") if item.strip()}
            rows = [row for row in rows if row["id"] in allowed]
        name_filter = params.get("name", "")
        if name_filter.startswith("ilike."):
            target_name = name_filter.replace("ilike.", "").strip("*").lower()
            rows = [row for row in rows if (row.get("name") or "").lower() == target_name]
        return rows


def _request():
    return SimpleNamespace(state=SimpleNamespace(user_id=USER_ID))


def _install_repo(monkeypatch, *, citation_payload_builder=None):
    repo = QuoteWorkflowRepo()
    monkeypatch.setattr(citations, "supabase_repo", repo)
    monkeypatch.setattr(research_entities, "supabase_repo", repo)

    async def fake_list_citation_records(_user_id, *, ids=None, limit=50, search=None, format=None):
        del limit, search, format
        builder = citation_payload_builder or _shared_citation_payload
        return [builder(citation_id) for citation_id in (ids or [])]

    monkeypatch.setattr(citations, "list_citation_records", fake_list_citation_records)
    return repo


def test_quote_list_returns_hydrated_cards(monkeypatch):
    _repo = _install_repo(monkeypatch)

    response = asyncio.run(citations.list_quotes(_request()))

    assert [item["id"] for item in response] == [
        QUOTE_DELTA_UNATTACHED,
        QUOTE_ALPHA_LATE,
        QUOTE_GAMMA_ONLY,
        QUOTE_BETA_EARLY,
        QUOTE_ALPHA_EARLY,
    ]
    assert response[1]["citation"]["id"] == CITATION_ALPHA
    assert response[1]["note_ids"] == [
        "99999999-0000-4000-8000-000000000001",
        "99999999-0000-4000-8000-000000000002",
    ]
    assert response[1]["note_count"] == 2
    assert response[1]["workflow"] == {"has_notes": True}


def test_quote_list_uses_shared_citation_hydration_path_with_deduped_ids(monkeypatch):
    _repo = _install_repo(monkeypatch)
    calls = []

    async def spy_list_citation_records(user_id, *, ids=None, limit=50, search=None, format=None):
        calls.append(
            {
                "user_id": user_id,
                "ids": list(ids or []),
                "limit": limit,
                "search": search,
                "format": format,
            }
        )
        return [_shared_citation_payload(citation_id) for citation_id in (ids or [])]

    monkeypatch.setattr(citations, "list_citation_records", spy_list_citation_records)

    response = asyncio.run(citations.list_quotes(_request(), citation_id=CITATION_ALPHA))

    assert [item["id"] for item in response] == [QUOTE_ALPHA_LATE, QUOTE_ALPHA_EARLY]
    assert calls == [
        {
            "user_id": USER_ID,
            "ids": [CITATION_ALPHA],
            "limit": 1,
            "search": None,
            "format": None,
        }
    ]


def test_quote_embedded_citation_exactly_matches_shared_hydration_payload(monkeypatch):
    rich_payload = {
        "id": CITATION_ALPHA,
        "format": "chicago",
        "excerpt": "Shared excerpt payload",
        "quote": "Shared quoted sentence",
        "full_citation": "Shared Full Citation",
        "inline_citation": "(Doe 2024)",
        "footnote": "1. Doe, Shared.",
        "quote_attribution": '"Shared quoted sentence" (Doe 2024)',
        "url": "https://example.com/shared",
        "metadata": {"locator": {"chapter": 3}, "schema": "shared"},
        "source": {
            "id": "source-shared",
            "title": "Shared Source",
            "publisher": "Shared Publisher",
            "canonical_url": "https://canonical.example/shared",
        },
    }

    def builder(citation_id: str) -> dict:
        if citation_id == CITATION_ALPHA:
            return deepcopy(rich_payload)
        return _shared_citation_payload(citation_id)

    _repo = _install_repo(monkeypatch, citation_payload_builder=builder)

    response = asyncio.run(citations.list_quotes(_request(), ids=QUOTE_ALPHA_EARLY))

    assert response[0]["citation"] == rich_payload


def test_create_quote_uses_shared_citation_hydration_path(monkeypatch):
    repo = _install_repo(monkeypatch)
    calls = []

    async def spy_list_citation_records(user_id, *, ids=None, limit=50, search=None, format=None):
        calls.append({"user_id": user_id, "ids": list(ids or []), "limit": limit})
        return [_shared_citation_payload(citation_id) for citation_id in (ids or [])]

    monkeypatch.setattr(citations, "list_citation_records", spy_list_citation_records)

    response = asyncio.run(
        citations.create_quote(
            _request(),
            citations.QuoteInput(
                citation_id=CITATION_ALPHA,
                excerpt="Created quote excerpt",
                locator={"paragraph": 4},
                annotation="Created annotation",
            ),
        )
    )

    assert response["citation"] == _shared_citation_payload(CITATION_ALPHA)
    assert calls == [{"user_id": USER_ID, "ids": [CITATION_ALPHA], "limit": 1}]
    quote_post = [call for call in repo.calls if call[0] == "post" and call[1] == "quotes"][-1]
    assert quote_post[2]["json"]["citation_id"] == CITATION_ALPHA


def test_quote_list_filters_by_citation_id(monkeypatch):
    _repo = _install_repo(monkeypatch)

    response = asyncio.run(citations.list_quotes(_request(), citation_id=CITATION_ALPHA))

    assert [item["id"] for item in response] == [QUOTE_ALPHA_LATE, QUOTE_ALPHA_EARLY]
    assert all(item["citation_id"] == CITATION_ALPHA for item in response)


def test_quote_list_ids_mode_preserves_order_and_ignores_missing(monkeypatch):
    _repo = _install_repo(monkeypatch)

    response = asyncio.run(
        citations.list_quotes(
            _request(),
            ids=f"{QUOTE_GAMMA_ONLY},{QUOTE_ALPHA_LATE},{QUOTE_ALPHA_LATE},{QUOTE_MISSING}",
        )
    )

    assert [item["id"] for item in response] == [QUOTE_GAMMA_ONLY, QUOTE_ALPHA_LATE]


def test_quote_list_ids_mode_rejects_invalid_or_combined_filters(monkeypatch):
    _repo = _install_repo(monkeypatch)

    with pytest.raises(HTTPException) as invalid_excinfo:
        asyncio.run(citations.list_quotes(_request(), ids="not-a-uuid"))
    with pytest.raises(HTTPException) as combined_excinfo:
        asyncio.run(citations.list_quotes(_request(), ids=QUOTE_ALPHA_LATE, citation_id=CITATION_ALPHA))

    assert invalid_excinfo.value.status_code == 400
    assert combined_excinfo.value.status_code == 400


def test_quote_list_document_filter_returns_only_grounded_quotes_in_attachment_order(monkeypatch):
    _repo = _install_repo(monkeypatch)

    response = asyncio.run(citations.list_quotes(_request(), document_id=DOCUMENT_ID))

    assert [item["id"] for item in response] == [
        QUOTE_ALPHA_EARLY,
        QUOTE_ALPHA_LATE,
        QUOTE_BETA_EARLY,
        QUOTE_GAMMA_ONLY,
    ]
    assert QUOTE_DELTA_UNATTACHED not in [item["id"] for item in response]
    assert [item["citation_id"] for item in response] == [
        CITATION_ALPHA,
        CITATION_ALPHA,
        CITATION_BETA,
        CITATION_GAMMA,
    ]


def test_quote_list_document_and_citation_filters_intersect(monkeypatch):
    _repo = _install_repo(monkeypatch)

    response = asyncio.run(citations.list_quotes(_request(), document_id=DOCUMENT_ID, citation_id=CITATION_ALPHA))

    assert [item["id"] for item in response] == [QUOTE_ALPHA_EARLY, QUOTE_ALPHA_LATE]
    assert all(item["citation_id"] == CITATION_ALPHA for item in response)


def test_quote_list_document_filter_paginates_after_ordering(monkeypatch):
    _repo = _install_repo(monkeypatch)

    full_response = asyncio.run(citations.list_quotes(_request(), document_id=DOCUMENT_ID))
    limited = asyncio.run(citations.list_quotes(_request(), document_id=DOCUMENT_ID, limit=2))
    offset_only = asyncio.run(citations.list_quotes(_request(), document_id=DOCUMENT_ID, offset=1))
    sliced = asyncio.run(citations.list_quotes(_request(), document_id=DOCUMENT_ID, limit=2, offset=1))

    expected_ids = [item["id"] for item in full_response]
    assert expected_ids == [QUOTE_ALPHA_EARLY, QUOTE_ALPHA_LATE, QUOTE_BETA_EARLY, QUOTE_GAMMA_ONLY]
    assert [item["id"] for item in limited] == expected_ids[:2]
    assert [item["id"] for item in offset_only] == expected_ids[1:]
    assert [item["id"] for item in sliced] == expected_ids[1:3]


def test_create_quote_rejects_invalid_uuid_and_short_excerpt(monkeypatch):
    _repo = _install_repo(monkeypatch)

    with pytest.raises(HTTPException) as uuid_excinfo:
        asyncio.run(
            citations.create_quote(
                _request(),
                citations.QuoteInput(citation_id="not-a-uuid", excerpt="Long enough excerpt"),
            )
        )
    with pytest.raises(HTTPException) as excerpt_excinfo:
        asyncio.run(
            citations.create_quote(
                _request(),
                citations.QuoteInput(citation_id=CITATION_ALPHA, excerpt="too short"),
            )
        )

    assert uuid_excinfo.value.status_code == 422
    assert excerpt_excinfo.value.status_code == 422


def test_quote_note_helper_creates_linked_note_with_deterministic_defaults(monkeypatch):
    repo = _install_repo(monkeypatch)

    response = asyncio.run(citations.create_quote_note(_request(), QUOTE_ALPHA_LATE, citations.QuoteNoteInput()))

    assert response["ok"] is True
    note_post = [call for call in repo.calls if call[0] == "post" and call[1] == "notes"][-1]
    payload = note_post[2]["json"]
    assert payload["quote_id"] == QUOTE_ALPHA_LATE
    assert payload["citation_id"] == CITATION_ALPHA
    assert payload["highlight_text"] == "Alpha late quote excerpt"
    assert payload["note_body"] == "Alpha late quote excerpt\n\nAnnotation: Alpha annotation"


def test_quote_note_helper_passes_supported_overrides(monkeypatch):
    repo = _install_repo(monkeypatch)

    response = asyncio.run(
        citations.create_quote_note(
            _request(),
            QUOTE_BETA_EARLY,
            citations.QuoteNoteInput(
                title="Override title",
                note_body="Override body",
                project_id=PROJECT_ID,
                tags=["Concept"],
            ),
        )
    )

    assert response["ok"] is True
    note_post = [call for call in repo.calls if call[0] == "post" and call[1] == "notes"][-1]
    payload = note_post[2]["json"]
    assert payload["title"] == "Override title"
    assert payload["note_body"] == "Override body"
    assert payload["project_id"] == PROJECT_ID
    assert repo.rpc_calls[-1][0] == "replace_note_tag_links_atomic"


def test_quote_note_helper_rejects_missing_and_foreign_quotes(monkeypatch):
    _repo = _install_repo(monkeypatch)

    with pytest.raises(HTTPException) as missing_excinfo:
        asyncio.run(citations.create_quote_note(_request(), QUOTE_MISSING, citations.QuoteNoteInput()))
    with pytest.raises(HTTPException) as foreign_excinfo:
        asyncio.run(citations.create_quote_note(_request(), QUOTE_FOREIGN, citations.QuoteNoteInput()))

    assert missing_excinfo.value.status_code == 404
    assert foreign_excinfo.value.status_code == 403
