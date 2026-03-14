import importlib
from types import SimpleNamespace

from concurrent.futures import ThreadPoolExecutor

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
        return SimpleNamespace(user=DummyUser(self.user_id))


class DummyTable:
    def __init__(self, account_type: str):
        self.account_type = account_type

    def select(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def single(self):
        return self

    def execute(self):
        return SimpleNamespace(data={"name": "Tier User", "account_type": self.account_type, "daily_limit": 5})


class DummyClient:
    def __init__(self, account_type: str):
        self.auth = DummyAuth("user-1")
        self.account_type = account_type

    def table(self, *_args, **_kwargs):
        return DummyTable(self.account_type)


class DummyResp:
    def __init__(self, status_code: int, payload, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload


class DummyHTTPClient:
    def __init__(self, templates_payload=None):
        self.templates_payload = templates_payload if templates_payload is not None else []
        self.last_url = None

    async def get(self, url, params=None, headers=None):
        self.last_url = url
        if "citation_templates" in url:
            return DummyResp(200, self.templates_payload)

        if "unlock_history" in url:
            return DummyResp(200, [{"url": "https://example.com"}])

        if "rest/v1/citations" in url and params and "id" in params:
            ids_param = params["id"]
            if "bad!" in ids_param:
                return DummyResp(400, {"message": "bad id"}, text="bad id")
            return DummyResp(200, [{"id": "1", "url": "https://example.com"}])

        return DummyResp(200, [])


class DummySupabaseRepo:
    def headers(self, **_kwargs):
        return {"x-test": "1"}

    async def get(self, resource, **kwargs):
        params = kwargs.get("params", {})
        if resource == "citation_instances":
            if "bad!" in (params.get("id") or ""):
                return DummyResp(400, {"message": "bad id"}, text="bad id")
            rows = [{"id": "1", "source_id": "source-1", "locator": {}, "quote_text": "Excerpt", "excerpt": "Excerpt", "annotation": "", "citation_version": "cv1", "created_at": "2026-01-01T00:00:00+00:00"}]
            if params.get("id") and "2" in params["id"]:
                rows.append({"id": "2", "source_id": "source-2", "locator": {}, "quote_text": "Excerpt 2", "excerpt": "Excerpt 2", "annotation": "", "citation_version": "cv2", "created_at": "2026-01-02T00:00:00+00:00"})
            if params.get("id") and "3" in params["id"]:
                rows.append({"id": "3", "source_id": "source-3", "locator": {}, "quote_text": "Excerpt 3", "excerpt": "Excerpt 3", "annotation": "", "citation_version": "cv3", "created_at": "2026-01-03T00:00:00+00:00"})
            return DummyResp(200, rows)
        if resource == "sources":
            ids = params.get("id", "")
            rows = []
            for source_id in ["source-1", "source-2", "source-3"]:
                if not ids or source_id in ids:
                    rows.append({
                        "id": source_id,
                        "fingerprint": f"url:https://example.com/{source_id}",
                        "title": f"Title {source_id}",
                        "source_type": "webpage",
                        "authors": [{"fullName": "Author Example", "firstName": "Author", "lastName": "Example", "initials": "A", "isOrganization": False}],
                        "container_title": "Example Site",
                        "publisher": "Example Site",
                        "issued_date": {"raw": "2024-01-01", "year": 2024},
                        "identifiers": {},
                        "canonical_url": f"https://example.com/{source_id}",
                        "page_url": f"https://example.com/{source_id}",
                        "metadata": {"title_case": f"Title {source_id}", "sentence_case": f"Title {source_id}", "siteName": "Example Site", "author": "Author Example"},
                        "raw_extraction": {},
                        "normalization_version": 1,
                        "source_version": f"sv-{source_id}",
                    })
            return DummyResp(200, rows)
        if resource == "citation_renders":
            return DummyResp(200, [])
        return DummyResp(200, [])

    async def post(self, resource, **kwargs):
        return DummyResp(201, [{"id": "ok", **(kwargs.get("json") or {})}])

    async def patch(self, resource, **kwargs):
        return DummyResp(200, [{"id": "ok", **(kwargs.get("json") or {})}])

    async def delete(self, resource, **kwargs):
        return DummyResp(204, [])


def _build_app(monkeypatch, account_type="pro", http_client=None):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda _url, _key: DummyClient(account_type))

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

    if http_client is not None:
        from app.routes import citations, search, history

        citations.http_client = http_client
        citations.supabase_repo = DummySupabaseRepo()
        search.http_client = http_client
        history.http_client = http_client

    return main.app


def test_citation_templates_returns_empty_list_for_pro_without_templates(monkeypatch):
    app = _build_app(monkeypatch, account_type="pro", http_client=DummyHTTPClient(templates_payload=[]))
    client = TestClient(app)

    response = client.get("/api/citation-templates", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert response.json() == []


def test_citation_templates_returns_templates_for_pro(monkeypatch):
    templates = [{"id": "t1", "name": "APA", "template": "{author}", "created_at": "", "updated_at": ""}]
    app = _build_app(monkeypatch, account_type="pro", http_client=DummyHTTPClient(templates_payload=templates))
    client = TestClient(app)

    response = client.get("/api/citation-templates", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert response.json() == templates


def test_citations_by_ids_invalid_input_returns_422(monkeypatch):
    app = _build_app(monkeypatch, account_type="pro", http_client=DummyHTTPClient())
    client = TestClient(app)

    response = client.get("/api/citations/by_ids?ids=bad!,2", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "CITATION_IDS_INVALID"


def test_citations_by_ids_missing_ids_returns_empty_list(monkeypatch):
    app = _build_app(monkeypatch, account_type="pro", http_client=DummyHTTPClient())
    client = TestClient(app)

    response = client.get("/api/citations/by_ids?ids=", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert response.json() == []


def test_citations_by_ids_parallel_calls_stay_successful(monkeypatch):
    app = _build_app(monkeypatch, account_type="pro", http_client=DummyHTTPClient())
    client = TestClient(app)

    def make_call():
        return client.get("/api/citations/by_ids?ids=1,2,3", headers={"Authorization": "Bearer valid"})

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _x: make_call(), range(8)))

    assert all(r.status_code == 200 for r in responses)


def test_history_missing_token_returns_machine_readable_401(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard", http_client=DummyHTTPClient())
    client = TestClient(app)

    response = client.get("/api/history")

    assert response.status_code == 401
    payload = response.json()
    code = payload.get("code") or payload.get("detail", {}).get("code")
    assert code in {"AUTH_INVALID", "AUTH_MISSING"}


def test_history_standard_uses_request_auth_without_authorization_header_roundtrip(monkeypatch):
    app = _build_app(monkeypatch, account_type="standard", http_client=DummyHTTPClient())
    client = TestClient(app)

    response = client.get("/api/history", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert response.json() == [{"url": "https://example.com"}]


def test_history_free_tier_remains_strictly_gated(monkeypatch):
    app = _build_app(monkeypatch, account_type="free", http_client=DummyHTTPClient())
    client = TestClient(app)

    response = client.get("/api/history", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "HISTORY_SEARCH_TIER_LOCKED"


def test_unlocks_free_tier_is_capped_to_five(monkeypatch):
    http = DummyHTTPClient()
    app = _build_app(monkeypatch, account_type="free", http_client=http)
    client = TestClient(app)

    response = client.get("/api/unlocks?limit=100", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert "limit=5" in (http.last_url or "")


def test_unlocks_paid_tier_can_request_longer_history(monkeypatch):
    http = DummyHTTPClient()
    app = _build_app(monkeypatch, account_type="pro", http_client=http)
    client = TestClient(app)

    response = client.get("/api/unlocks?limit=100", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert "limit=100" in (http.last_url or "")
