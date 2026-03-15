import importlib
import asyncio
from types import SimpleNamespace

import pytest
import supabase


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, token):
        return SimpleNamespace(user=DummyUser(self.user_id))


class DummyInsert:
    def execute(self):
        return SimpleNamespace(data=[{"id": 1}], error=None)


class DummyTable:
    def __init__(self, account_type: str):
        self.account_type = account_type

    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return SimpleNamespace(data={"name": "Tier User", "account_type": self.account_type, "daily_limit": 5})


class DummyClient:
    def __init__(self, account_type: str):
        self.auth = DummyAuth("user-1")
        self.account_type = account_type

    def table(self, *args, **kwargs):
        return DummyTable(self.account_type)


class DummyResp:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class DummyRepo:
    async def get(self, resource, *args, **kwargs):
        if resource == "document_citations":
            return DummyResp(200, [])
        if resource == "document_tags":
            return DummyResp(200, [])
        return DummyResp(200, [{"title": "Doc", "content_delta": {"ops": [{"insert": "x\n"}]}, "project_id": None, "created_at": "2020-01-01T00:00:00+00:00"}])

    async def post(self, resource, *args, **kwargs):
        if resource == "document_citations":
            return DummyResp(201, [])
        if resource == "document_tags":
            return DummyResp(201, [])
        return DummyResp(201, [{"id": "doc-1", "title": "Untitled", "content_delta": {"ops": [{"insert": "\n"}]}, "project_id": None, "updated_at": "2026-01-01T00:00:00+00:00"}])

    async def patch(self, *args, **kwargs):
        return DummyResp(200, [{"id": "doc-1", "project_id": None}])

    async def delete(self, resource, *args, **kwargs):
        if resource == "document_citations":
            return DummyResp(204, [])
        return DummyResp(204, [])

    async def rpc(self, function_name, **kwargs):
        payload = kwargs.get("json") or {}
        if function_name == "replace_document_citations_atomic":
            return DummyResp(200, payload.get("p_citation_ids", []))
        if function_name == "replace_document_tags_atomic":
            return DummyResp(200, payload.get("p_tag_ids", []))
        return DummyResp(404, {"message": f'function "{function_name}" does not exist'})

    def headers(self, *args, **kwargs):
        return {}


def _build_app(monkeypatch, account_type="standard"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient(account_type))

    from app import main

    importlib.reload(main)

    redis_data = {}

    async def redis_get(key):
        return redis_data.get(key, 0)

    async def redis_set(key, value, ttl_seconds=None):
        redis_data[key] = value
        return True

    async def redis_incr(key):
        redis_data[key] = int(redis_data.get(key, 0)) + 1
        return redis_data[key]

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_set = redis_set
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire

    from app.routes import editor
    from app.services import research_entities

    repo = DummyRepo()
    editor.supabase_repo = repo
    research_entities.supabase_repo = repo
    return main.app


def _request(*, account_type="standard", user_id="user-1", redis_data=None):
    store = redis_data if redis_data is not None else {}

    async def redis_get(key):
        return store.get(key, 0)

    async def redis_set(key, value, ttl_seconds=None):
        store[key] = value
        return True

    async def redis_incr(key):
        store[key] = int(store.get(key, 0)) + 1
        return store[key]

    async def redis_expire(_key, _seconds):
        return True

    return SimpleNamespace(
        state=SimpleNamespace(user_id=user_id, account_type=account_type),
        app=SimpleNamespace(state=SimpleNamespace(redis_get=redis_get, redis_set=redis_set, redis_incr=redis_incr, redis_expire=redis_expire)),
    )


def test_standard_unlock_permit_limited_to_15_per_day(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import extension

    request = _request(account_type="standard")
    for _ in range(15):
        response = asyncio.run(extension.extension_unlock_permit(request, extension.ExtensionPermitRequest()))
        assert response["allowed"] is True
        assert response["usage_period"] == "day"

    denied = asyncio.run(extension.extension_unlock_permit(request, extension.ExtensionPermitRequest()))
    assert denied["allowed"] is False


def test_standard_doc_creation_blocked_at_16th(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    async def fake_count(*args, **kwargs):
        return 15

    monkeypatch.setattr(editor, "_count_docs_in_window", fake_count)

    with pytest.raises(Exception) as excinfo:
        asyncio.run(editor.create_doc(_request(account_type="standard"), editor.DocumentCreate()))
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail["toast"] == "Document limit reached for this period. Upgrade to Pro for unlimited access."


def test_standard_archived_doc_blocks_edit_but_allows_export(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    async def fake_fetch_doc_core(*args, **kwargs):
        return {"created_at": "2020-01-01T00:00:00+00:00"}

    monkeypatch.setattr(editor, "_fetch_doc_core", fake_fetch_doc_core)

    with pytest.raises(Exception) as excinfo:
        asyncio.run(
            editor.update_doc(
                _request(account_type="standard"),
                "doc-1",
                editor.DocumentUpdate(title="T", content_delta={"ops": [{"insert": "x"}]}, content_html="<p>x</p>", attached_citation_ids=[]),
            )
        )
    assert excinfo.value.status_code == 403
    assert excinfo.value.detail["toast"] == "This document is archived. Upgrade to Pro to restore editing."

    export_res = asyncio.run(
        editor.export_doc(
            _request(account_type="standard"),
            "doc-1",
            editor.ExportRequest(format="docx", style="mla"),
        )
    )
    assert export_res["archived"] is True
    assert export_res["format"] == "docx"


def test_standard_export_file_pdf_returns_real_pdf(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    export_data = asyncio.run(
        editor.export_doc(
            _request(account_type="standard"),
            "doc-1",
            editor.ExportRequest(format="pdf", style="mla"),
        )
    )

    body = editor._build_pdf_bytes(export_data["html"], export_data["bibliography"], title=export_data["title"])
    assert body.startswith(b"%PDF")


def test_standard_export_file_docx_returns_zip_container(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    export_data = asyncio.run(
        editor.export_doc(
            _request(account_type="standard"),
            "doc-1",
            editor.ExportRequest(format="docx", style="mla"),
        )
    )

    body = editor._build_docx_bytes(export_data["html"], export_data["bibliography"])
    assert body[:2] == b"PK"




def test_standard_export_file_uses_document_title_for_filename(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    response = asyncio.run(
        editor.export_doc_file(_request(account_type="standard"), "doc-1", format="pdf", style="mla")
    )

    assert 'filename="Doc.pdf"' in response.headers["content-disposition"]


def test_standard_export_file_docx_preserves_inline_formatting(monkeypatch):
    _build_app(monkeypatch, account_type="standard")
    from app.routes import editor

    class RichDocRepo(DummyRepo):
        async def get(self, *args, **kwargs):
            return DummyResp(
                200,
                [
                    {
                        "title": "Rich Doc",
                        "content_delta": {"ops": [{"insert": "Bold Italic\n"}]},
                        "content_html": "<p><strong>Bold</strong> <em>Italic</em></p>",
                        "citation_ids": [],
                        "created_at": "2020-01-01T00:00:00+00:00",
                    }
                ],
            )

    editor.supabase_repo = RichDocRepo()
    export_data = asyncio.run(
        editor.export_doc(
            _request(account_type="standard"),
            "doc-1",
            editor.ExportRequest(format="docx", style="mla"),
        )
    )

    import zipfile
    from io import BytesIO

    with zipfile.ZipFile(BytesIO(editor._build_docx_bytes(export_data["html"], export_data["bibliography"]))) as archive:
        document_xml = archive.read("word/document.xml").decode("utf-8")

    assert "<w:b/>" in document_xml
    assert "<w:i/>" in document_xml

def test_pro_unlock_permit_unlimited(monkeypatch):
    _build_app(monkeypatch, account_type="pro")
    from app.routes import extension

    payload = asyncio.run(extension.extension_unlock_permit(_request(account_type="pro"), extension.ExtensionPermitRequest()))
    assert payload["allowed"] is True
    assert payload["remaining"] == -1
    assert payload["usage_period"] == "unlimited"
