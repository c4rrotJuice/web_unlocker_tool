import pytest

from app.modules.identity.repo import IdentityRepository


class FakeResponse:
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeSupabaseRepo:
    def __init__(self, *, post_response=None, get_response=None):
        self.post_response = post_response
        self.get_response = get_response
        self.post_calls = []
        self.get_calls = []

    async def post(self, resource, *, params=None, json=None, headers=None):
        self.post_calls.append(
            {
                "resource": resource,
                "params": params,
                "json": json,
                "headers": headers,
            }
        )
        return self.post_response

    async def get(self, resource, *, params=None, headers=None):
        self.get_calls.append(
            {
                "resource": resource,
                "params": params,
                "headers": headers,
            }
        )
        return self.get_response


@pytest.mark.anyio
async def test_update_preferences_upserts_supported_columns_only():
    fake_repo = FakeSupabaseRepo(
        post_response=FakeResponse(
            200,
            [
                {
                    "user_id": "user-1",
                    "theme": "dark",
                    "editor_density": "comfortable",
                    "default_citation_style": "apa",
                    "sidebar_collapsed": True,
                    "created_at": "2026-03-21T00:00:00Z",
                    "updated_at": "2026-03-21T00:00:00Z",
                }
            ],
        )
    )
    repo = IdentityRepository(
        user_supabase_repo=fake_repo,
        bootstrap_supabase_repo=fake_repo,
        anon_key="anon-key",
    )

    updated = await repo.update_preferences(
        "user-1",
        "access-token",
        {
            "theme": "dark",
            "editor_density": "comfortable",
            "sidebar_collapsed": True,
            "sidebar_auto_hide": True,
        },
    )

    assert updated is not None
    assert updated["theme"] == "dark"
    assert updated["sidebar_collapsed"] is True
    assert len(fake_repo.post_calls) == 1
    assert fake_repo.post_calls[0]["resource"] == "user_preferences"
    assert fake_repo.post_calls[0]["params"] == {"on_conflict": "user_id"}
    assert fake_repo.post_calls[0]["json"] == {
        "user_id": "user-1",
        "theme": "dark",
        "editor_density": "comfortable",
        "sidebar_collapsed": True,
        "sidebar_auto_hide": True,
    }
    assert fake_repo.post_calls[0]["headers"]["Prefer"] == "return=representation,resolution=merge-duplicates"
    assert fake_repo.post_calls[0]["headers"]["Authorization"] == "Bearer access-token"


@pytest.mark.anyio
async def test_update_preferences_ignores_unsupported_only_patch():
    existing = {
        "user_id": "user-1",
        "theme": "system",
        "editor_density": "comfortable",
        "default_citation_style": "apa",
        "sidebar_collapsed": False,
        "sidebar_auto_hide": False,
        "created_at": "2026-03-21T00:00:00Z",
        "updated_at": "2026-03-21T00:00:00Z",
    }
    fake_repo = FakeSupabaseRepo(get_response=FakeResponse(200, [existing]))
    repo = IdentityRepository(
        user_supabase_repo=fake_repo,
        bootstrap_supabase_repo=fake_repo,
        anon_key="anon-key",
    )

    updated = await repo.update_preferences(
        "user-1",
        "access-token",
        {"legacy_toggle": True},
    )

    assert updated == existing
    assert fake_repo.post_calls == []
    assert len(fake_repo.get_calls) == 1
    assert fake_repo.get_calls[0]["resource"] == "user_preferences"
    assert fake_repo.get_calls[0]["params"] == {"select": "*", "user_id": "eq.user-1", "limit": "1"}


@pytest.fixture
def anyio_backend():
    return "asyncio"
