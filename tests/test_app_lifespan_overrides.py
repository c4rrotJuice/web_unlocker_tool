import asyncio
import os

from fastapi import FastAPI

os.environ.setdefault("SUPABASE_URL", "http://example.com")
os.environ.setdefault("SUPABASE_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")

from app.main import lifespan


async def _noop(*_args, **_kwargs):
    return 0


def test_lifespan_preserves_preconfigured_state_doubles():
    app = FastAPI()
    app.state.redis_get = _noop
    app.state.redis_set = _noop
    app.state.redis_incr = _noop
    app.state.redis_expire = _noop
    app.state.http_session = object()

    original = (
        app.state.redis_get,
        app.state.redis_set,
        app.state.redis_incr,
        app.state.redis_expire,
        app.state.http_session,
    )

    async def run():
        async with lifespan(app):
            assert app.state.redis_get is original[0]
            assert app.state.redis_set is original[1]
            assert app.state.redis_incr is original[2]
            assert app.state.redis_expire is original[3]
            assert app.state.http_session is original[4]

    asyncio.run(run())
