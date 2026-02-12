from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
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
ENV = validate_environment()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
WEB_UNLOCKER_SUPABASE_URL = os.getenv("WEB_UNLOCKER_SUPABASE_URL") or SUPABASE_URL
WEB_UNLOCKER_SUPABASE_ANON_KEY = os.getenv("WEB_UNLOCKER_SUPABASE_ANON_KEY") or SUPABASE_KEY

# Clients
supabase_anon = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Sanity check
try:
    supabase_admin.table("user_meta").select("id").limit(1).execute()
    print("✅ Supabase admin connection OK")
except Exception as e:
    print("❌ Supabase connection failed:", e)


# ============================== APP LIFESPAN =============================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ✅ Use the shared client you already created in app.routes.http
    app.state.http_session = http_client
    app.state.fetch_limiter = PriorityLimiter(
        int(os.getenv("FETCH_CONCURRENCY", "5"))
    )

    # ✅ Wrap Redis so the rest of your code can keep calling redis_get(key)
    app.state.redis_get = lambda key: r.redis_get(key, app.state.http_session)
    app.state.redis_set = lambda key, value, ttl_seconds=None: r.redis_set(
        key, value, app.state.http_session, ttl_seconds=ttl_seconds
    )
    app.state.redis_incr = lambda key: r.redis_incr(key, app.state.http_session)
    app.state.redis_expire = lambda key, seconds: r.redis_expire(key, seconds, app.state.http_session)

    print("✅ HTTP client + Redis ready")

    try:
        yield
    finally:
        # ✅ close the shared client (and remove the extra shutdown event below)
        await app.state.http_session.aclose()
        print("👋 HTTP client closed")


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
    request.state.request_id = request.headers.get("X-Request-ID") or str(uuid4())
    public_path = is_public_path(request.url.path)
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
            user_res = supabase_anon.auth.get_user(token)
            user = user_res.user
            if not user:
                raise Exception("Invalid token")

            request.state.user_id = user.id
            request.state.email = user.email
            print("✅ user id:", user.id)

        except Exception as e:
            print("[AuthMiddleware] Token validation failed:", e)
            if public_path:
                return await call_next(request)
            return JSONResponse({"error": "Unauthorized"}, status_code=401)

        # ✅ Fetch metadata with SERVICE ROLE
        try:
            cache_key = f"user_meta:{user.id}"
            cached_meta = None
            try:
                cached_meta = await request.app.state.redis_get(cache_key)
            except Exception as e:
                print("⚠️ Failed to read metadata cache:", e)

            if isinstance(cached_meta, dict):
                request.state.name = cached_meta.get("name")
                request.state.account_type = normalize_account_type(
                    cached_meta.get("account_type")
                )
                request.state.usage_limit = cached_meta.get("daily_limit", 5)
            else:
                meta = (
                    supabase_admin
                    .table("user_meta")
                    .select("name, account_type, daily_limit")
                    .eq("user_id", user.id)
                    .single()
                    .execute()
                )

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
                        print("⚠️ Failed to write metadata cache:", e)

        except Exception as e:
            print("⚠️ Failed to fetch metadata:", e)

    response = await call_next(request)

    return response



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
    return RedirectResponse("/static/auth.html")


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


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
