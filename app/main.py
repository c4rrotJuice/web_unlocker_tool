from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from supabase import create_client
import httpx
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

@app.on_event("shutdown")
async def shutdown():
    await http_client.aclose()


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



'''
from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from app.routes.upstash_redis import redis_get, redis_set, redis_incr, redis_expire
from httpx import AsyncClient
from dotenv import load_dotenv
from supabase import create_client, __version__ as supabase_version
import httpx

import os



load_dotenv()

# --- Supabase Init ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    res = supabase.table("ip_usage").select("*").limit(1).execute()
    print("✅ Supabase connection successful")
except Exception as e:
    print(f"❌ Supabase connection failed: {e}")


# --- Lifespan Context Manager ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Shared HTTPX client
    app.state.http_session = AsyncClient(timeout=10)
    # Attach redis functions
    app.state.redis_get = redis_get
    app.state.redis_set = redis_set
    app.state.redis_incr = redis_incr
    app.state.redis_expire = redis_expire


    print("✅ HTTP client and Upstash Redis ready")

    try:
        yield
    finally:
        await app.state.http_session.aclose()
        print("👋 Cleaned up HTTP resources")


# --- App Factory ---
app = FastAPI(lifespan=lifespan)

# Mounting static files and templates
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

# CORS setup for when i publicly deploy
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # will have to Replace with domain list in prod, for now, my local set up runs as is
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    try:
        print("🔔 Middleware running")
        auth_header = request.headers.get("authorization")
        print("Auth header:", auth_header)

        user_id = None
        token = None
        account_type = None
        name = None
        usage_limit = 5  # default fallback

        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ")[1]

            # Step 1: Verifying the token
            try:
                async with httpx.AsyncClient() as client:
                    user_res = await client.get(
                        f"{SUPABASE_URL}/auth/v1/user",
                        headers={
                            "Authorization": f"Bearer {token}",
                            "apikey": SUPABASE_KEY
                        }
                    )
                    if user_res.status_code != 200:
                        raise Exception(f"Invalid token: {user_res.status_code}")
                    user_data = user_res.json()
                    user_id = user_data.get("id")
                    print("✅ user id:", user_id)
            except Exception as e:
                print(f"[AuthMiddleware] Token validation failed: {e}")
                return JSONResponse(
                    {"error": "Unauthorized: Invalid or expired token."},
                    status_code=401
                )

            # Step 2: Fetching user metadata
            try:
                async with httpx.AsyncClient() as client:
                    meta_res = await client.get(
                        f"{SUPABASE_URL}/rest/v1/user_meta?user_id=eq.{user_id}&select=account_type,daily_limit",
                        headers={
                            "apikey": SUPABASE_KEY,
                            "Authorization": f"Bearer {SUPABASE_KEY}",
                            "Content-Type": "application/json"
                        }
                    )
                    meta_res.raise_for_status()
                    meta_data = meta_res.json()
                    if meta_data:
                        name = meta_data[0].get("name"),
                        account_type = meta_data[0].get("account_type")
                        usage_limit = meta_data[0].get("daily_limit", 5)
                        print(f"📦 account_type={account_type}, limit={usage_limit}, name={name}")
            except Exception as e:
                print(f"⚠️ Failed to fetch metadata: {e}")

        # Step 3: Attach to request.state
        request.state.user_id = user_id
        request.state.token = token
        request.state.account_type = account_type
        request.state.usage_limit = usage_limit
        request.state.name = name

        return await call_next(request)

    except Exception as e:
        print(f"🔥 Middleware Error: {e}")
        return JSONResponse(
            {"error": "Internal Server Error", "details": str(e)},
            status_code=500
        )
 



# ---Default Routes ---
@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("home.html", {"request": request})

@app.post("/", response_class=HTMLResponse)
async def render_url(request: Request, url: str = Form(...), unlock: str = Form("on")):
    unlock_bool = unlock == "on"
    return templates.TemplateResponse("home.html", {
        "request": request,
        "url": url,
        "unlock": unlock_bool
    })
    
@app.get("/auth", response_class=HTMLResponse)
async def auth_page(request: Request):
    return templates.TemplateResponse("auth.html", {"request": request})
    
    
@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


# Include routers/routes
from app.routes import render
from app.services import authentication
from app.routes import dashboard
from app.routes import history
from app.routes import citations
from app.routes import bookmarks
from app.routes import search
from app.routes import payments

app.include_router(render.router)
app.include_router(authentication.router)
app.include_router(dashboard.router)
app.include_router(history.router)
app.include_router(citations.router)
app.include_router(bookmarks.router)
app.include_router(search.router)
app.include_router(payments.router)
'''