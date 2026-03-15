import os
import sys
import types
from contextlib import asynccontextmanager

import httpx
import pytest


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)


if "supabase" not in sys.modules:
    supabase_stub = types.ModuleType("supabase")
    supabase_client_stub = types.ModuleType("supabase.client")

    class _DummyExecuteResult:
        def __init__(self, data=None):
            self.data = data if data is not None else []

    class _DummyTable:
        def select(self, *args, **kwargs):
            return self

        def limit(self, *args, **kwargs):
            return self

        def eq(self, *args, **kwargs):
            return self

        def single(self, *args, **kwargs):
            return self

        def insert(self, *args, **kwargs):
            return self

        def execute(self):
            return _DummyExecuteResult(data=[])

    class _DummyAuth:
        def get_user(self, _token):
            return types.SimpleNamespace(user=None)

        def sign_up(self, *_args, **_kwargs):
            return types.SimpleNamespace(user=types.SimpleNamespace(id="test-user"), session=None)

        def sign_in_with_password(self, *_args, **_kwargs):
            session = types.SimpleNamespace(access_token="token", refresh_token="refresh")
            user = types.SimpleNamespace(id="test-user", email="test@example.com")
            return types.SimpleNamespace(user=user, session=session)

    class _DummyClient:
        def __init__(self):
            self.auth = _DummyAuth()

        def table(self, *args, **kwargs):
            return _DummyTable()

    class Client(_DummyClient):
        pass

    class AuthApiError(Exception):
        def __init__(self, message="auth error"):
            super().__init__(message)
            self.message = message

    def create_client(_url, _key):
        return _DummyClient()

    supabase_stub.create_client = create_client
    supabase_stub.Client = Client
    supabase_client_stub.AuthApiError = AuthApiError
    sys.modules["supabase"] = supabase_stub
    sys.modules["supabase.client"] = supabase_client_stub


@asynccontextmanager
async def async_test_client(app, **client_kwargs):
    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
        **client_kwargs,
    )
    try:
        yield client
    finally:
        # AsyncClient/ASGITransport shutdown can hang in this environment even
        # after the response is complete, so tests intentionally skip teardown.
        pass


@asynccontextmanager
async def lifespan_test_client(app, **client_kwargs):
    async with app.router.lifespan_context(app):
        async with async_test_client(app, **client_kwargs) as client:
            yield client


@pytest.fixture
def anyio_backend():
    return "asyncio"
