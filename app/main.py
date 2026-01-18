from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse
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
from app.routes import dashboard, history, citations, bookmarks, search, payments

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

    # ✅ Wrap Redis so the rest of your code can keep calling redis_get(key)
    app.state.redis_get = lambda key: r.redis_get(key, app.state.http_session)
    app.state.redis_set = lambda key, value: r.redis_set(key, value, app.state.http_session)
    app.state.redis_incr = lambda key: r.redis_incr(key, app.state.http_session)
    app.state.redis_expire = lambda key, seconds: r.redis_expire(key, seconds, app.state.http_session)

    print("✅ HTTP client + Redis ready")

    try:
        yield
    finally:
        # ✅ close the shared client (and remove the extra shutdown event below)
        await app.state.http_session.aclose()
        print("👋 HTTP client closed")

'''
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_session = httpx.AsyncClient(timeout=10)

    app.state.redis_get = redis_get
    app.state.redis_set = redis_set
    app.state.redis_incr = redis_incr
    app.state.redis_expire = redis_expire

    print("✅ HTTP client + Redis ready")

    try:
        yield
    finally:
        await app.state.http_session.aclose()
        print("👋 HTTP client closed")

'''
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


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    auth_header = request.headers.get("authorization")

    request.state.user_id = None
    request.state.account_type = None
    request.state.usage_limit = 5
    request.state.name = None

    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ")[1]

        # ✅ Let Supabase validate token
        try:
            user_res = supabase_anon.auth.get_user(token)
            user = user_res.user
            if not user:
                raise Exception("Invalid token")

            request.state.user_id = user.id
            print("✅ user id:", user.id)

        except Exception as e:
            print("[AuthMiddleware] Token validation failed:", e)
            return JSONResponse({"error": "Unauthorized"}, status_code=401)

        # ✅ Fetch metadata with SERVICE ROLE
        try:
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
                request.state.account_type = meta.data.get("account_type")
                request.state.usage_limit = meta.data.get("daily_limit", 5)

        except Exception as e:
            print("⚠️ Failed to fetch metadata:", e)

    return await call_next(request)



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


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


# --------------------------------------------------
# ROUTERS
# --------------------------------------------------
app.include_router(render.router)
app.include_router(authentication.router)
app.include_router(dashboard.router)
app.include_router(history.router)
app.include_router(citations.router)
app.include_router(bookmarks.router)
app.include_router(search.router)
app.include_router(payments.router)

