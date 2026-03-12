import importlib

import supabase
from fastapi.testclient import TestClient


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, _token):
        return type("DummyUserResponse", (), {"user": DummyUser(self.user_id)})


class DummyInsert:
    def execute(self):
        return type("DummyInsertResponse", (), {"data": [{"id": 1}]})


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self, *args, **kwargs):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return type("DummyExecute", (), {"data": {"name": "Tester", "account_type": "standard", "daily_limit": 5}})


class DummyClient:
    def __init__(self, user_id: str):
        self.auth = DummyAuth(user_id)

    def table(self, *args, **kwargs):
        return DummyTable()


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else [{"id": "ok"}]
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeSupabaseRepo:
    def __init__(self):
        self.calls = []

    def headers(self, **kwargs):
        return {"x-test": "1", **({"prefer": kwargs.get("prefer")} if kwargs.get("prefer") else {})}

    async def get(self, resource, **kwargs):
        self.calls.append(("get", resource, kwargs))
        if resource == "notes" and kwargs.get("params", {}).get("id", "").startswith("eq."):
            return FakeResponse(200, [{
                "id": kwargs["params"]["id"].replace("eq.", ""),
                "title": "Research note",
                "highlight_text": "Highlighted sentence",
                "note_body": "Body",
                "source_url": "https://example.com/paper",
                "source_title": "Paper Title",
                "citation_id": None,
            }])
        return FakeResponse(200, [{"id": "n"}], headers={"content-range": "0-0/17"})

    async def post(self, resource, **kwargs):
        self.calls.append(("post", resource, kwargs))
        return FakeResponse(201, [{"id": "n"}])

    async def patch(self, resource, **kwargs):
        self.calls.append(("patch", resource, kwargs))
        return FakeResponse(200, [{"id": "n"}])

    async def delete(self, resource, **kwargs):
        self.calls.append(("delete", resource, kwargs))
        return FakeResponse(204, [])


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient("user-notes"))

    from app import main

    importlib.reload(main)

    async def redis_get(_key):
        return 0

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    main.app.state.http_session = None
    return main


def test_notes_create_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Title",
        "note_body": "Body",
        "source_url": "https://example.com/a",
        "tags": ["43f2fbbf-2390-4ea3-bfc4-28ea0803aca7"],
    }

    response = client.post("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert any(call[0] == "post" and call[1] == "notes" for call in repo.calls)
    assert any(call[0] == "post" and call[1] == "note_note_tags" for call in repo.calls)


def test_notes_update_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Title2",
        "note_body": "Body2",
        "tags": [],
    }

    response = client.patch("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)


def test_notes_delete_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    response = client.delete(f"/api/notes/{note_id}", headers={"Authorization": "Bearer token"})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert any(call[0] == "delete" and call[1] == "notes" for call in repo.calls)


def test_notes_create_sync_generates_id_when_missing(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "title": "No ID",
        "note_body": "Body",
        "source_url": "https://example.com/a",
        "tags": [],
    }

    response = client.post("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    note_id = response.json()["note_id"]
    assert isinstance(note_id, str)
    assert len(note_id) == 36


def test_notes_create_sync_accepts_comma_separated_tags(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Tags",
        "note_body": "Body",
        "tags": "43f2fbbf-2390-4ea3-bfc4-28ea0803aca7, 5ec57fbc-5662-47f5-8abf-4f95ce13fd77",
    }

    response = client.post("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    join_posts = [call for call in repo.calls if call[0] == "post" and call[1] == "note_note_tags"]
    assert len(join_posts) == 1
    rows = join_posts[0][2]["json"]
    assert len(rows) == 2


def test_notes_create_sync_accepts_legacy_body_field(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Legacy",
        "body": "Body from legacy field",
        "tags": [],
    }

    response = client.post("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    note_post = [call for call in repo.calls if call[0] == "post" and call[1] == "notes"][0]
    assert note_post[2]["json"]["note_body"] == "Body from legacy field"


def test_notes_update_sync_supports_partial_patch_without_note_body(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    payload = {
        "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        "title": "Title only",
    }

    response = client.patch("/api/notes", headers={"Authorization": "Bearer token"}, json=payload)

    assert response.status_code == 200
    patch_call = [call for call in repo.calls if call[0] == "patch" and call[1] == "notes"][0]
    assert "note_body" not in patch_call[2]["json"]


def test_notes_list_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    response = client.get("/api/notes?limit=999&offset=-4", headers={"Authorization": "Bearer token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["total_count"] == 17
    assert len(payload["notes"]) == 1

    get_call = [call for call in repo.calls if call[0] == "get" and call[1] == "notes"][0]
    params = get_call[2]["params"]
    assert params["limit"] == "500"
    assert params["offset"] == "0"
    assert params["order"] == "created_at.desc"


def test_notes_archive_and_restore(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    client = TestClient(main.app)
    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"

    archive_res = client.post(f"/api/notes/{note_id}/archive", headers={"Authorization": "Bearer token"})
    restore_res = client.post(f"/api/notes/{note_id}/restore", headers={"Authorization": "Bearer token"})

    assert archive_res.status_code == 200
    assert restore_res.status_code == 200
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)


def test_create_citation_from_note_links_note(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo

    async def fake_account_type(_request, _user_id):
        return "standard"

    async def fake_create_citation(_user_id, _account_type, _citation_input):
        return "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"

    extension._get_account_type = fake_account_type
    extension.create_citation = fake_create_citation

    client = TestClient(main.app)
    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    response = client.post(f"/api/notes/{note_id}/citation", headers={"Authorization": "Bearer token"})

    assert response.status_code == 200
    assert response.json()["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)
