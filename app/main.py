from fastapi import FastAPI, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from supabase import create_client
from app.routes.http import http_client
from app.routes import upstash_redis as r
import os
from uuid import uuid4

# Redis helpers
from app.routes.upstash_redis import (
    redis_get,
    redis_set,
    redis_incr,
    redis_expire
)

# Routers
from app.routes.http import http_client
from app.routes import render
from app.services import authentication
from app.services.entitlements import normalize_account_type
from app.services.priority_limiter import PriorityLimiter
from app.routes import dashboard, history, citations, bookmarks, search, payments, editor, extension, auth_handoff
from app.config.environment import validate_environment
from app.logging_utils import configure_logging, set_request_context, clear_request_context
from app.services.metrics import metrics, record_dependency_call
from app.services.resilience import call_blocking_with_timeout
import logging
import time


def _read_process_rss_megabytes() -> float:
    try:
        with open("/proc/self/status", "r", encoding="utf-8") as status_file:
            for line in status_file:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return float(parts[1]) / 1024.0
    except OSError:
        return 0.0
    return 0.0


def _parse_cors_origins(value: str | None) -> list[str]:
    if not value:
        return []
    return [origin.strip() for origin in value.split(",") if origin.strip()]


def get_cors_settings() -> tuple[list[str], bool]:
    env = ENV
    configured_origins = _parse_cors_origins(os.getenv("CORS_ORIGINS"))

    if env in {"staging", "prod"}:
        if not configured_origins:
            raise RuntimeError("❌ CORS_ORIGINS must be set in staging/prod and cannot be empty")
        if any(origin == "*" for origin in configured_origins):
            raise RuntimeError("❌ CORS_ORIGINS cannot contain '*' in staging/prod")
        allow_origins = configured_origins
    else:
        dev_localhost_origins = [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:4173",
            "http://localhost:8080",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:4173",
            "http://127.0.0.1:8080",
        ]
        allow_origins = list(dict.fromkeys(configured_origins + dev_localhost_origins))

    # This app uses cookie-based auth via wu_access_token and anon cookies.
    uses_cookie_auth = True
    return allow_origins, uses_cookie_auth

# --------------------------------------------------
# ENV + SUPABASE
# --------------------------------------------------
load_dotenv()
configure_logging()
logger = logging.getLogger(__name__)
ENV = validate_environment()

SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}


def apply_baseline_security_headers(response):
    for header, value in SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    return response


def _status_bucket(status_code: int) -> str:
    if status_code >= 500:
        return "5xx"
    if status_code >= 400:
        return "4xx"
    if status_code >= 300:
        return "3xx"
    return "2xx"


def _route_metric_key(path: str) -> str:
    normalized = path.strip("/") or "root"
    safe = []
    for char in normalized:
        safe.append(char if char.isalnum() else "_")
    return "".join(safe)[:80]

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
WEB_UNLOCKER_SUPABASE_URL = os.getenv("WEB_UNLOCKER_SUPABASE_URL") or SUPABASE_URL
WEB_UNLOCKER_SUPABASE_ANON_KEY = os.getenv("WEB_UNLOCKER_SUPABASE_ANON_KEY") or SUPABASE_KEY


SUPABASE_CALL_TIMEOUT_SECONDS = float(os.getenv("SUPABASE_CALL_TIMEOUT_SECONDS", "4.0"))
SUPABASE_RETRY_ATTEMPTS = int(os.getenv("SUPABASE_RETRY_ATTEMPTS", "2"))


async def _supabase_call(callable_fn):
    last_error = None
    for attempt in range(1, SUPABASE_RETRY_ATTEMPTS + 1):
        try:
            return await call_blocking_with_timeout(callable_fn, timeout_s=SUPABASE_CALL_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            last_error = exc
            if attempt >= SUPABASE_RETRY_ATTEMPTS:
                raise
    raise RuntimeError("supabase call failed") from last_error

# Clients
supabase_anon = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Sanity check
try:
    record_dependency_call(
        "supabase",
        lambda: supabase_admin.table("user_meta").select("id").limit(1).execute(),
    )
    logger.info("supabase.admin_connection_ok")
except Exception as e:
    logger.exception("supabase.connection_failed", extra={"error": str(e)})


# ============================== APP LIFESPAN =============================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ✅ Use the shared client you already created in app.routes.http
    app.state.http_session = http_client
    app.state.fetch_limiter = PriorityLimiter(
        int(os.getenv("FETCH_CONCURRENCY", "5"))
    )
    metrics.set_gauge_callback("process.memory_rss_mb", _read_process_rss_megabytes)
    metrics.set_gauge_callback(
        "unlock_pipeline.queue_depth", lambda: float(app.state.fetch_limiter.queue_depth)
    )
    metrics.set_gauge_callback(
        "unlock_pipeline.in_flight", lambda: float(app.state.fetch_limiter.in_flight)
    )

    # ✅ Wrap Redis so the rest of your code can keep calling redis_get(key)
    app.state.redis_get = lambda key: r.redis_get(key, app.state.http_session)
    app.state.redis_set = lambda key, value, ttl_seconds=None: r.redis_set(
        key, value, app.state.http_session, ttl_seconds=ttl_seconds
    )
    app.state.redis_incr = lambda key: r.redis_incr(key, app.state.http_session)
    app.state.redis_expire = lambda key, seconds: r.redis_expire(key, seconds, app.state.http_session)

    logger.info("app.startup_ready")

    try:
        yield
    finally:
        # ✅ close the shared client (and remove the extra shutdown event below)
        await app.state.http_session.aclose()
        logger.info("app.shutdown_http_client_closed")


# --------------------------------------------------
# APP INIT
# --------------------------------------------------
app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

cors_allow_origins, cors_allow_credentials = get_cors_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_credentials=cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ====================== AUTH MIDDLEWARE ====================

# Paths that never require authentication
PUBLIC_PATH_PREFIXES = (
    "/",
    "/auth",
    "/static",
)

PUBLIC_PATHS = {
    "/api/auth/handoff/exchange",
    "/api/public-config",
    "/webhooks/paddle",
}

def is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    if path == "/":
        return True
    for prefix in PUBLIC_PATH_PREFIXES:
        if prefix == "/":
            continue
        if path.startswith(prefix):
            return True
    return False

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID") or request.headers.get("X-Request-Id") or str(uuid4())
    public_path = is_public_path(request.url.path)
    start = time.perf_counter()
    auth_header = request.headers.get("authorization")
    if not auth_header:
        access_cookie = request.cookies.get("wu_access_token")
        if access_cookie:
            auth_header = f"Bearer {access_cookie}"

    request.state.user_id = None
    request.state.account_type = None
    request.state.usage_limit = 5
    request.state.name = None
    request.state.email = None

    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ")[1]

        # ✅ Let Supabase validate token
        try:
            user_res = await _supabase_call(lambda: record_dependency_call("supabase", lambda: supabase_anon.auth.get_user(token)))
            user = user_res.user
            if not user:
                raise Exception("Invalid token")

            request.state.user_id = user.id
            request.state.email = user.email
            logger.info("auth.user_validated", extra={"user_id": user.id})

        except Exception as e:
            logger.warning("auth.token_validation_failed", extra={"error": str(e)})
            if public_path:
                response = await call_next(request)
                response.headers["X-Request-Id"] = request.state.request_id
                return apply_baseline_security_headers(response)
            response = JSONResponse({"code": "AUTH_INVALID", "message": "Unauthorized"}, status_code=401)
            response.headers["X-Request-Id"] = request.state.request_id
            return apply_baseline_security_headers(response)

        # ✅ Fetch metadata with SERVICE ROLE
        try:
            cache_key = f"user_meta:{user.id}"
            cached_meta = None
            try:
                cached_meta = await request.app.state.redis_get(cache_key)
            except Exception as e:
                logger.warning("auth.metadata_cache_read_failed", extra={"error": str(e)})

            if isinstance(cached_meta, dict):
                request.state.name = cached_meta.get("name")
                request.state.account_type = normalize_account_type(
                    cached_meta.get("account_type")
                )
                request.state.usage_limit = cached_meta.get("daily_limit", 5)
            else:
                meta = await _supabase_call(lambda: record_dependency_call(
                    "supabase",
                    lambda: (
                        supabase_admin
                        .table("user_meta")
                        .select("name, account_type, daily_limit")
                        .eq("user_id", user.id)
                        .single()
                        .execute()
                    ),
                ))

                if meta.data:
                    request.state.name = meta.data.get("name")
                    request.state.account_type = normalize_account_type(
                        meta.data.get("account_type")
                    )
                    request.state.usage_limit = meta.data.get("daily_limit", 5)
                    try:
                        await request.app.state.redis_set(
                            cache_key,
                            meta.data,
                            ttl_seconds=300,
                        )
                    except Exception as e:
                        logger.warning("auth.metadata_cache_write_failed", extra={"error": str(e)})

        except Exception as e:
            logger.warning("auth.metadata_fetch_failed", extra={"error": str(e)})

    set_request_context(
        request_id=request.state.request_id,
        route=request.url.path,
        user_id=request.state.user_id,
    )
    response = None
    try:
        response = await call_next(request)
    finally:
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        status = getattr(response, "status_code", 500)
        metrics.inc("http.request_count")
        metrics.observe_ms("http.request_latency", latency_ms)
        route_key = _route_metric_key(request.url.path)
        status_bucket = _status_bucket(status)
        metrics.inc(f"http.route.{route_key}.{status_bucket}")
        if status >= 400:
            metrics.inc("http.error_count")
        set_request_context(status=status, latency_ms=latency_ms, upstream=None)
        logger.info("request.completed")
        clear_request_context()

    response.headers["X-Request-Id"] = request.state.request_id
    return apply_baseline_security_headers(response)



# --------------------------------------------------
# BASIC ROUTES
# --------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("home.html", {"request": request})


@app.post("/", response_class=HTMLResponse)
async def render_url(
    request: Request,
    url: str = Form(...),
    unlock: str = Form("on")
):
    return templates.TemplateResponse(
        "home.html",
        {
            "request": request,
            "url": url,
            "unlock": unlock == "on"
        }
    )


@app.get("/auth", response_class=HTMLResponse)
async def auth_page(request: Request):
    return templates.TemplateResponse(
        "auth.html",
        {
            "request": request,
            "supabase_url": WEB_UNLOCKER_SUPABASE_URL,
            "supabase_key": WEB_UNLOCKER_SUPABASE_ANON_KEY,
        },
    )


@app.get("/api/public-config", response_class=JSONResponse)
async def public_config():
    return {
        "WEB_UNLOCKER_SUPABASE_URL": WEB_UNLOCKER_SUPABASE_URL,
        "WEB_UNLOCKER_SUPABASE_ANON_KEY": WEB_UNLOCKER_SUPABASE_ANON_KEY,
    }


@app.get("/auth/handoff", response_class=HTMLResponse)
async def auth_handoff_page(request: Request):
    return templates.TemplateResponse(
        "auth_handoff.html",
        {
            "request": request,
            "supabase_url": WEB_UNLOCKER_SUPABASE_URL,
            "supabase_key": WEB_UNLOCKER_SUPABASE_ANON_KEY,
        },
    )


@app.get("/login")
async def login_redirect():
    return RedirectResponse("/auth")




@app.get("/signin")
async def signin_redirect():
    return RedirectResponse("/auth")


@app.get("/auth/login")
async def auth_login_redirect():
    return RedirectResponse("/auth")

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/dashboard/metrics", response_class=HTMLResponse)
async def metrics_dashboard_page(request: Request):
    return templates.TemplateResponse("metrics_dashboard.html", {"request": request})


@app.get("/metrics")
async def metrics_endpoint(request: Request):
    if not request.state.user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if normalize_account_type(request.state.account_type) != "dev":
        raise HTTPException(status_code=403, detail="Metrics access requires a dev account.")
    return PlainTextResponse(
        content=metrics.render_prometheus(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )

# --------------------------------------------------
# ROUTERS
# --------------------------------------------------
app.include_router(render.router)
app.include_router(authentication.router)
app.include_router(auth_handoff.router)
app.include_router(dashboard.router)
app.include_router(history.router)
app.include_router(citations.router)
app.include_router(bookmarks.router)
app.include_router(search.router)
app.include_router(payments.router)
app.include_router(editor.router)
app.include_router(extension.router)
