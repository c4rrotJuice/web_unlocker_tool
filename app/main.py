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

# --------------------------------------------------
# ENV + SUPABASE
# --------------------------------------------------
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY]):
    raise RuntimeError("❌ Missing Supabase environment variables")

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
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
    public_path = is_public_path(request.url.path)
    auth_header = request.headers.get("authorization")

    if not auth_header:
        token_cookie = request.cookies.get("access_token")
        if token_cookie and not public_path:
            auth_header = f"Bearer {token_cookie}"

    refresh_token_cookie = request.cookies.get("refresh_token")

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
            refreshed = False
            if refresh_token_cookie and not public_path:
                try:
                    refresh_res = supabase_anon.auth.refresh_session(refresh_token_cookie)
                    refreshed_session = getattr(refresh_res, "session", None)
                    refreshed_access_token = getattr(refreshed_session, "access_token", None)
                    refreshed_refresh_token = getattr(refreshed_session, "refresh_token", None)
                    if refreshed_access_token:
                        user_res = supabase_anon.auth.get_user(refreshed_access_token)
                        user = user_res.user
                        if user:
                            request.state.user_id = user.id
                            request.state.email = user.email
                            request.state.refreshed_access_token = refreshed_access_token
                            request.state.refreshed_refresh_token = refreshed_refresh_token
                            refreshed = True
                except Exception as refresh_error:
                    print("[AuthMiddleware] Token refresh failed:", refresh_error)

            if not refreshed:
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

    refreshed_access_token = getattr(request.state, "refreshed_access_token", None)
    if refreshed_access_token and not public_path:
        refreshed_refresh_token = getattr(request.state, "refreshed_refresh_token", None)
        cookie_secure_default = os.getenv("COOKIE_SECURE", "true").lower() != "false"
        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
        request_is_https = request.url.scheme == "https" or forwarded_proto == "https"
        secure_cookie = cookie_secure_default and request_is_https
        response.set_cookie(
            "access_token",
            refreshed_access_token,
            httponly=True,
            secure=secure_cookie,
            samesite="lax",
            max_age=3600,
            path="/",
        )
        if refreshed_refresh_token:
            response.set_cookie(
                "refresh_token",
                refreshed_refresh_token,
                httponly=True,
                secure=secure_cookie,
                samesite="lax",
                max_age=60 * 60 * 24 * 30,
                path="/",
            )

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
    return templates.TemplateResponse("auth.html", {"request": request})


@app.get("/auth/handoff", response_class=HTMLResponse)
async def auth_handoff_page(request: Request):
    return templates.TemplateResponse(
        "auth_handoff.html",
        {
            "request": request,
            "supabase_url": SUPABASE_URL,
            "supabase_key": SUPABASE_KEY,
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
