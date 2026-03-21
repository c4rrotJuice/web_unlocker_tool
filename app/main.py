from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.core.errors import register_error_handlers
from app.core.security import initialize_security
from app.core.config import get_settings
from app.modules.billing.routes import router as billing_router
from app.modules.extension.routes import router as extension_router
from app.modules.identity.routes import router as identity_router
from app.modules.insights.routes import router as insights_router
from app.modules.research.routes import router as research_router, status_router as research_status_router
from app.modules.unlock.routes import router as unlock_router
from app.modules.workspace.routes import router as workspace_router, status_router as workspace_status_router
from app.routes.shell import router as shell_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not hasattr(app.state, "rate_limiter"):
        app.state.rate_limiter = None
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    static_dir = Path(__file__).resolve().parent / "static"
    app = FastAPI(
        title="Writior v2 Rebuild",
        version="2.0.0-rebuild",
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url="/redoc" if settings.enable_docs else None,
        lifespan=lifespan,
    )
    initialize_security(app, settings)
    register_error_handlers(app)

    @app.get("/healthz", tags=["system"])
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok", "schema_contract": settings.schema_contract_source}

    @app.get("/api/public-config", tags=["system"])
    async def public_config() -> dict[str, object]:
        return {
            "canonical_app_origin": settings.canonical_app_origin,
            "cors_origins": list(settings.cors_origins),
            "supabase_url": settings.supabase_url,
            "supabase_anon_key": settings.supabase_anon_key,
            "paddle_client_side_token": settings.paddle_client_side_token,
            "paddle_environment": settings.paddle_environment,
        }

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    app.include_router(shell_router)
    app.include_router(identity_router)
    app.include_router(billing_router)
    app.include_router(unlock_router)
    app.include_router(research_status_router)
    app.include_router(research_router)
    app.include_router(workspace_status_router)
    app.include_router(workspace_router)
    app.include_router(extension_router)
    app.include_router(insights_router)
    return app


app = create_app()
