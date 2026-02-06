from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import render
from app.services.unprotector import FetchOutcome


def _build_app():
    app = FastAPI()
    @app.middleware("http")
    async def _state_middleware(request, call_next):
        request.state.account_type = "free"
        return await call_next(request)

    app.include_router(render.router)

    async def _redis_get(_key):
        return None

    async def _redis_set(_key, _value, ttl_seconds=None):
        return None

    async def _redis_incr(_key):
        return 1

    async def _redis_expire(_key, _seconds):
        return True

    app.state.redis_get = _redis_get
    app.state.redis_set = _redis_set
    app.state.redis_incr = _redis_incr
    app.state.redis_expire = _redis_expire
    app.state.http_session = None
    app.state.fetch_limiter = None
    return app


def test_view_route_returns_403_json_for_block(monkeypatch):
    app = _build_app()

    async def _check_login(request, **kwargs):
        return {"user_id": "u1", "use_cloudscraper": True}

    async def _fetch(**kwargs):
        return FetchOutcome(
            success=False,
            html="<html>blocked</html>",
            http_status=403,
            attempts=2,
            outcome_reason="blocked_by_cloudflare",
            provider="cloudflare",
            confidence="high",
            reasons=["status_403_cloudflare"],
            ray_id="ray-123",
        )

    async def _save(*args, **kwargs):
        return "inserted"

    monkeypatch.setattr(render, "check_login", _check_login)
    monkeypatch.setattr(render, "fetch_and_clean_page", _fetch)
    monkeypatch.setattr(render, "save_unlock_history", _save)

    client = TestClient(app)
    res = client.post("/view", json={"url": "https://blocked.example", "unlock": True}, headers={"Authorization": "Bearer tok", "Accept": "application/json"})

    assert res.status_code == 403
    assert res.json()["success"] is False
    assert res.json()["suggested_action"] == "use_browser_mode"


def test_view_route_returns_html_for_success(monkeypatch):
    app = _build_app()

    async def _check_login(request, **kwargs):
        return {"user_id": "u1", "use_cloudscraper": True}

    async def _fetch(**kwargs):
        return FetchOutcome(
            success=True,
            html="<html><body>ok</body></html>",
            http_status=200,
            attempts=1,
            outcome_reason="ok",
            provider="unknown",
            confidence="none",
            reasons=[],
            ray_id=None,
        )

    async def _save(*args, **kwargs):
        return "inserted"

    monkeypatch.setattr(render, "check_login", _check_login)
    monkeypatch.setattr(render, "fetch_and_clean_page", _fetch)
    monkeypatch.setattr(render, "save_unlock_history", _save)

    client = TestClient(app)
    res = client.post("/view", json={"url": "https://ok.example", "unlock": True}, headers={"Authorization": "Bearer tok"})

    assert res.status_code == 200
    assert "ok" in res.text
