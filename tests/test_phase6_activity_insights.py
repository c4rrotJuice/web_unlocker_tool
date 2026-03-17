from __future__ import annotations

import importlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import supabase

from tests.conftest import async_test_client


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"
        self.aud = "authenticated"
        self.role = "authenticated"


class ValidAuth:
    def get_user(self, token):
        return type("DummyResponse", (), {"user": DummyUser("user-1")})


class DummyClient:
    def __init__(self):
        self.auth = ValidAuth()


class StoredIdentityRepository:
    def __init__(self, *, tier: str = "standard"):
        self.tier = tier

    async def fetch_profile(self, user_id: str, access_token: str):
        return {"display_name": "User One", "use_case": "research"}

    async def fetch_preferences(self, user_id: str, access_token: str):
        return {
            "theme": "system",
            "editor_density": "comfortable",
            "default_citation_style": "apa",
            "sidebar_collapsed": False,
        }

    async def fetch_entitlement(self, user_id: str, access_token: str):
        return {
            "tier": self.tier,
            "status": "active",
            "paid_until": "2099-01-01T00:00:00Z",
            "auto_renew": True,
            "source": "paddle",
        }

    async def bootstrap_user(self, user_id: str, *, display_name: str | None, use_case: str | None):
        return True


class FakeUnlockRepository:
    def __init__(self):
        self.events: list[dict[str, object]] = []
        self.bookmarks: list[dict[str, object]] = []
        self.milestones: list[dict[str, object]] = []
        self.unlock_days_override: list[date] | None = None

    async def insert_activity_event(self, *, payload: dict[str, object]):
        event_id = payload.get("event_id")
        if event_id and any(row.get("event_id") == event_id and row.get("user_id") == payload.get("user_id") for row in self.events):
            existing = next(row for row in self.events if row.get("event_id") == event_id and row.get("user_id") == payload.get("user_id"))
            return True, existing
        row = {
            "id": f"event-{len(self.events) + 1}",
            **payload,
        }
        self.events.insert(0, row)
        return False, row

    async def get_event_by_event_id(self, *, user_id: str | None, event_id: str | None):
        for row in self.events:
            if row.get("user_id") == user_id and row.get("event_id") == event_id:
                return row
        return None

    async def list_activity_events(self, *, user_id: str, limit: int, direction: str, event_type: str | None, domain: str | None, cursor_created_at: str | None, cursor_id: str | None):
        rows = [row for row in self.events if row.get("user_id") == user_id]
        if event_type:
            rows = [row for row in rows if row.get("event_type") == event_type]
        if domain:
            rows = [row for row in rows if row.get("domain") == domain]
        return rows[:limit]

    async def count_unlock_events(self, *, user_id: str, event_type: str | None = None, start_at: str | None = None, end_at: str | None = None):
        rows = [row for row in self.events if row.get("user_id") == user_id]
        if event_type:
            rows = [row for row in rows if row.get("event_type") == event_type]
        return len(rows)

    async def get_unlock_days(self, *, user_id: str, start_date: date, end_date: date):
        if self.unlock_days_override is not None:
            return list(self.unlock_days_override)
        return []

    async def list_milestones(self, *, user_id: str, limit: int | None = None):
        rows = [row for row in self.milestones if row.get("user_id") == user_id]
        return rows[:limit] if limit is not None else rows

    async def insert_milestone(self, *, user_id: str, milestone_key: str, metadata: dict[str, object]):
        for row in self.milestones:
            if row["user_id"] == user_id and row["milestone_key"] == milestone_key:
                return False, row
        row = {
            "id": f"milestone-{len(self.milestones) + 1}",
            "user_id": user_id,
            "milestone_key": milestone_key,
            "awarded_at": datetime.now(timezone.utc).isoformat(),
            "metadata": metadata,
        }
        self.milestones.append(row)
        return True, row

    async def get_milestone(self, *, user_id: str, milestone_key: str):
        for row in self.milestones:
            if row["user_id"] == user_id and row["milestone_key"] == milestone_key:
                return row
        return None

    async def list_bookmarks(self, *, user_id: str, limit: int, direction: str, cursor_created_at: str | None, cursor_id: str | None):
        rows = [row for row in self.bookmarks if row.get("user_id") == user_id]
        return rows[:limit]

    async def find_bookmark_by_url(self, *, user_id: str, url: str):
        for row in self.bookmarks:
            if row.get("user_id") == user_id and row.get("url") == url:
                return row
        return None

    async def insert_bookmark(self, *, payload: dict[str, object]):
        existing = await self.find_bookmark_by_url(user_id=str(payload["user_id"]), url=str(payload["url"]))
        if existing is not None:
            return False, existing
        row = {
            "id": f"bookmark-{len(self.bookmarks) + 1}",
            "created_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        self.bookmarks.append(row)
        return True, row

    async def delete_bookmark(self, *, user_id: str, bookmark_id: str):
        for index, row in enumerate(self.bookmarks):
            if row.get("user_id") == user_id and row.get("id") == bookmark_id:
                deleted = self.bookmarks.pop(index)
                return [deleted]
        return []

    async def upsert_guest_usage(self, *, usage_key: str, usage_date: date):
        return {"usage_key": usage_key, "usage_date": usage_date.isoformat(), "usage_count": 1}


class FakeInsightsRepository:
    async def count_unlock_events(self, *, user_id: str, start_at: str, end_at: str, event_type: str | None = None):
        counts = {
            None: 6,
            "unlock": 3,
            "selection_capture": 2,
            "copy_assist": 1,
        }
        return counts[event_type]

    async def count_documents_updated(self, *, user_id: str, start_at: str, end_at: str):
        return 4

    async def get_unlock_days(self, *, user_id: str, start_date: date, end_date: date):
        today = end_date
        return [today - timedelta(days=offset) for offset in range(3)]

    async def get_monthly_domain_counts(self, *, user_id: str, month_start: date, month_end: date):
        return [{"domain": "example.com", "unlock_count": 3}, {"domain": "another.com", "unlock_count": 1}]

    async def get_monthly_citation_breakdown(self, *, user_id: str, month_start: date, month_end: date):
        return [{"style": "mla", "citation_count": 2}, {"style": "apa", "citation_count": 1}]

    async def list_milestones(self, *, user_id: str, month_start: str | None = None, month_end: str | None = None):
        return [
            {
                "id": "milestone-1",
                "milestone_key": "first_7_day_streak",
                "awarded_at": "2026-03-10T10:00:00+00:00",
                "metadata": {"threshold": 7},
            }
        ]


def _load_app(monkeypatch, *, tier: str = "standard"):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.writior.com")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient())

    import app.core.auth as core_auth
    import app.core.config as core_config
    from app import main
    from app.modules.extension import routes as extension_routes
    from app.modules.insights import routes as insights_routes
    from app.modules.unlock import routes as unlock_routes

    importlib.reload(core_auth)
    importlib.reload(core_config)
    core_config.get_settings.cache_clear()
    core_auth.get_token_verifier.cache_clear()
    unlock_routes = importlib.reload(unlock_routes)
    insights_routes = importlib.reload(insights_routes)
    extension_routes = importlib.reload(extension_routes)
    main = importlib.reload(main)

    identity_repo = StoredIdentityRepository(tier=tier)
    unlock_routes.identity_service.repository = identity_repo
    insights_routes.identity_service.repository = identity_repo
    extension_routes.service.identity_service.repository = identity_repo
    return main.app, unlock_routes, insights_routes, extension_routes


@pytest.mark.anyio
async def test_activity_event_history_and_milestones_are_canonical(monkeypatch):
    app, unlock_routes, _insights_routes, _extension_routes = _load_app(monkeypatch)
    fake_repo = FakeUnlockRepository()
    today = datetime.now(timezone.utc).date()
    fake_repo.unlock_days_override = [today - timedelta(days=offset) for offset in range(7)]
    unlock_routes.service.repository = fake_repo

    async with async_test_client(app) as client:
        response = await client.post(
            "/api/activity/events",
            headers={"Authorization": "Bearer valid"},
            json={
                "url": "https://example.com/article",
                "event_id": "3abf2c4a-c593-43ff-b5fe-123456789abc",
                "event_type": "unlock",
            },
        )
        history = await client.get("/api/activity/unlocks", headers={"Authorization": "Bearer valid"})
        milestones = await client.get("/api/activity/milestones", headers={"Authorization": "Bearer valid"})

    assert response.status_code == 200
    assert response.json()["data"]["event"]["event_type"] == "unlock"
    assert response.json()["data"]["milestones_awarded"][0]["key"] == "first_7_day_streak"
    assert history.status_code == 200
    assert history.json()["data"][0]["domain"] == "example.com"
    assert milestones.status_code == 200
    assert milestones.json()["data"][0]["key"] == "first_7_day_streak"


@pytest.mark.anyio
async def test_bookmark_create_list_delete_and_duplicate_are_deterministic(monkeypatch):
    app, unlock_routes, _insights_routes, _extension_routes = _load_app(monkeypatch, tier="standard")
    fake_repo = FakeUnlockRepository()
    unlock_routes.service.repository = fake_repo

    async with async_test_client(app) as client:
        first = await client.post(
            "/api/activity/bookmarks",
            headers={"Authorization": "Bearer valid"},
            json={"url": "https://example.com/article", "title": "Example"},
        )
        duplicate = await client.post(
            "/api/activity/bookmarks",
            headers={"Authorization": "Bearer valid"},
            json={"url": "https://example.com/article", "title": "Example"},
        )
        listing = await client.get("/api/activity/bookmarks", headers={"Authorization": "Bearer valid"})
        delete = await client.delete(
            f"/api/activity/bookmarks/{first.json()['data']['id']}",
            headers={"Authorization": "Bearer valid"},
        )

    assert first.status_code == 200
    assert first.json()["meta"]["created"] is True
    assert duplicate.status_code == 200
    assert duplicate.json()["meta"]["created"] is False
    assert duplicate.json()["data"]["id"] == first.json()["data"]["id"]
    assert listing.status_code == 200
    assert len(listing.json()["data"]) == 1
    assert delete.status_code == 200


@pytest.mark.anyio
async def test_bookmark_create_requires_capability_but_list_remains_available(monkeypatch):
    app, unlock_routes, _insights_routes, _extension_routes = _load_app(monkeypatch, tier="free")
    unlock_routes.service.repository = FakeUnlockRepository()

    async with async_test_client(app) as client:
        listing = await client.get("/api/activity/bookmarks", headers={"Authorization": "Bearer valid"})
        create = await client.post(
            "/api/activity/bookmarks",
            headers={"Authorization": "Bearer valid"},
            json={"url": "https://example.com/article"},
        )

    assert listing.status_code == 200
    assert listing.json()["data"] == []
    assert create.status_code == 403
    assert create.json()["detail"]["code"] == "capability_forbidden"


@pytest.mark.anyio
async def test_insights_and_report_metadata_use_canonical_sources(monkeypatch):
    app, _unlock_routes, insights_routes, _extension_routes = _load_app(monkeypatch, tier="pro")
    insights_routes.service.repository = FakeInsightsRepository()

    async with async_test_client(app) as client:
        momentum = await client.get("/api/insights/momentum?month=2026-03", headers={"Authorization": "Bearer valid", "X-User-Timezone": "UTC"})
        domains = await client.get("/api/insights/domains?month=2026-03", headers={"Authorization": "Bearer valid"})
        citation_styles = await client.get("/api/insights/citation-styles?month=2026-03", headers={"Authorization": "Bearer valid"})
        monthly = await client.get("/api/insights/monthly-summary?month=2026-03", headers={"Authorization": "Bearer valid"})
        report = await client.get("/api/reports/monthly?month=2026-03", headers={"Authorization": "Bearer valid"})

    assert momentum.status_code == 200
    assert momentum.json()["data"]["unlocks_this_month"] == 3
    assert momentum.json()["data"]["captures_this_month"] == 2
    assert domains.json()["data"][0] == {"domain": "example.com", "count": 3}
    assert citation_styles.json()["data"][0] == {"style": "mla", "count": 2}
    assert monthly.json()["data"]["report"]["status"] == "ready"
    assert report.status_code == 200
    assert report.headers["content-type"].startswith("application/json")
    assert report.json()["data"]["download_url"] is None
    assert report.json()["data"]["sections"]["domains"][0]["domain"] == "example.com"


def test_phase6_runtime_paths_do_not_reference_legacy_reporting_identifiers():
    root = Path(__file__).resolve().parents[1]
    targets = [
        root / "app/modules/unlock/repo.py",
        root / "app/modules/unlock/service.py",
        root / "app/modules/unlock/routes.py",
        root / "app/modules/insights/repo.py",
        root / "app/modules/insights/service.py",
        root / "app/modules/insights/routes.py",
    ]
    for path in targets:
        source = path.read_text()
        assert "unlock_" + "history" not in source
        assert "ip_" + "usage" not in source
        assert "user" + "_meta" not in source
