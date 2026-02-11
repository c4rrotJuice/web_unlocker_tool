#render.py
from fastapi import APIRouter, Request, Query, HTTPException, Header, Body
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from datetime import datetime
import uuid
import httpx
from app.routes.http import http_client

from app.services.unprotector import fetch_and_clean_page
from app.services.IP_usage_limit import check_login, get_user_ip
from app.services.entitlements import queue_priority
from app.routes.upstash_redis import redis_get, redis_set, redis_incr, redis_expire


load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
router = APIRouter()



class CleanPageRequest(BaseModel):
    url: str
    unlock: bool = True
    

@router.post("/view", response_class=HTMLResponse)
async def post_view_clean_page(
    request: Request,
    payload: dict = Body(...),
    authorization: str = Header(default=None)
):
    url = payload.get("url")
    unlock = payload.get("unlock", True)
    user_ip = get_user_ip(request)

    if not url:
        return HTMLResponse(content="<h3>Missing URL</h3>", status_code=400)

    if request.state.user_id:
        # Authenticated logic (Authorization bearer token or compatible cookie fallback via middleware)
        try:
            login_status = await check_login(
            request,
            redis_get=request.app.state.redis_get,
            redis_set=request.app.state.redis_set,
            redis_incr=request.app.state.redis_incr,
            redis_expire=request.app.state.redis_expire,
        )


        except HTTPException as e:
            return HTMLResponse(content=f"<h3>{e.detail}</h3>", status_code=e.status_code)
        except Exception as e:
            return HTMLResponse(content=f"<h3>Unexpected error: {str(e)}</h3>", status_code=500)

        if not isinstance(login_status, dict):
            return HTMLResponse(content=f"<h3>Login failed: {login_status}</h3>", status_code=401)

        user_id = login_status.get("user_id")
        use_cloudscraper = login_status.get("use_cloudscraper", False)
        priority = queue_priority(request.state.account_type)

        print(f"[🔒 AUTH] User ID: {user_id} | IP: {user_ip} | Unlock: True")

        try:
            cleaned_html = await fetch_and_clean_page(
                url=url,
                user_ip=user_ip,
                unlock=unlock,
                http_session=request.app.state.http_session,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                use_cloudscraper=use_cloudscraper,
                fetch_limiter=request.app.state.fetch_limiter,
                queue_priority=priority,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire
            )
            await save_unlock_history(user_id, url, None, request.app.state.http_session)
            #await save_unlock_history(user_id, url, request.app.state.http_session)
            return HTMLResponse(content=cleaned_html)
        except Exception as e:
            print(f"{e}")
            return HTMLResponse(content=f"<h1>Error loading page: {e}</h1>", status_code=500)

    else:
        # No Authorization: fallback to GET /view behavior
        print("[🌐 GUEST] No auth header, redirecting to /view")
        try:
            await check_login(
                request,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire,
            )
            priority = queue_priority(request.state.account_type)
            cleaned_html = await fetch_and_clean_page(
                url=url,
                user_ip=user_ip,
                unlock=unlock,
                http_session=request.app.state.http_session,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                use_cloudscraper=False,  # guest users
                fetch_limiter=request.app.state.fetch_limiter,
                queue_priority=priority,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire
            )
            
            return HTMLResponse(content=cleaned_html)
        except HTTPException as e:
            return HTMLResponse(content=f"<h3>{e.detail}</h3>", status_code=e.status_code)            
        except Exception as e:
            print(f"Error in fetch_and_clean_page: {e}")
            return HTMLResponse(content=f"<h1>Error loading page (guest): {e}</h1>", status_code=500)


@router.get("/view", response_class=HTMLResponse)
async def get_view_clean_page(
    request: Request,
    url: str = Query(None),
    unlock: bool = Query(True),
    authorization: str = Header(default=None),
):
    user_ip = get_user_ip(request)

    if not url:
        return HTMLResponse(content="<h3>Missing URL</h3>", status_code=400)

    if request.state.user_id:
        try:
            login_status = await check_login(
                request,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire,
            )
        except HTTPException as e:
            return HTMLResponse(content=f"<h3>{e.detail}</h3>", status_code=e.status_code)
        except Exception as e:
            return HTMLResponse(content=f"<h3>Unexpected error: {str(e)}</h3>", status_code=500)

        if not isinstance(login_status, dict):
            return HTMLResponse(content=f"<h3>Login failed: {login_status}</h3>", status_code=401)

        user_id = login_status.get("user_id")
        use_cloudscraper = login_status.get("use_cloudscraper", False)
        priority = queue_priority(request.state.account_type)

        try:
            cleaned_html = await fetch_and_clean_page(
                url=url,
                user_ip=user_ip,
                unlock=unlock,
                http_session=request.app.state.http_session,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                use_cloudscraper=use_cloudscraper,
                fetch_limiter=request.app.state.fetch_limiter,
                queue_priority=priority,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire,
            )
            await save_unlock_history(user_id, url, None, request.app.state.http_session)
            return HTMLResponse(content=cleaned_html)
        except Exception as e:
            print(f"{e}")
            return HTMLResponse(content=f"<h1>Error loading page: {e}</h1>", status_code=500)

    try:
        await check_login(
            request,
            redis_get=request.app.state.redis_get,
            redis_set=request.app.state.redis_set,
            redis_incr=request.app.state.redis_incr,
            redis_expire=request.app.state.redis_expire,
        )
        priority = queue_priority(request.state.account_type)
        cleaned_html = await fetch_and_clean_page(
            url=url,
            user_ip=user_ip,
            unlock=unlock,
            http_session=request.app.state.http_session,
            redis_get=request.app.state.redis_get,
            redis_set=request.app.state.redis_set,
            use_cloudscraper=False,
            fetch_limiter=request.app.state.fetch_limiter,
            queue_priority=priority,
            redis_incr=request.app.state.redis_incr,
            redis_expire=request.app.state.redis_expire,
        )
        return HTMLResponse(content=cleaned_html)
    except HTTPException as e:
        return HTMLResponse(content=f"<h3>{e.detail}</h3>", status_code=e.status_code)
    except Exception as e:
        print(f"Error in fetch_and_clean_page: {e}")
        return HTMLResponse(content=f"<h1>Error loading page (guest): {e}</h1>", status_code=500)


async def save_unlock_history(
    user_id: str,
    url: str,
    token: str,
    client: httpx.AsyncClient,
    *,
    source: str = "web",
    event_id: str | None = None,
) -> str:
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "url": url,
        "unlocked_at": datetime.utcnow().isoformat(),
        "source": source,
        "event_id": event_id,
    }
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    params = None
    if event_id:
        params = {"on_conflict": "user_id,event_id"}
        headers["Prefer"] = "return=representation,resolution=ignore-duplicates"

    res = await client.post(
        f"{SUPABASE_URL}/rest/v1/unlock_history",
        params=params,
        headers=headers,
        json=payload,
    )

    if event_id and res.status_code == 400:
        error_payload = {}
        try:
            error_payload = res.json()
        except ValueError:
            error_payload = {}

        if error_payload.get("code") == "42P10":
            existing = await client.get(
                f"{SUPABASE_URL}/rest/v1/unlock_history",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "Accept": "application/json",
                },
                params={
                    "user_id": f"eq.{user_id}",
                    "event_id": f"eq.{event_id}",
                    "select": "id",
                    "limit": 1,
                },
            )
            if existing.status_code == 200:
                existing_payload = existing.json()
                if existing_payload:
                    return "duplicate"

            res = await client.post(
                f"{SUPABASE_URL}/rest/v1/unlock_history",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                json=payload,
            )

    print(f"Insert status: {res.status_code}, body: {res.text}")
    if res.status_code not in (200, 201):
        return "failed"
    payload = res.json()
    if payload:
        return "inserted"
    return "duplicate"


@router.post("/fetch_and_clean_page", response_class=HTMLResponse)
async def fetch_and_clean_page_post(
    body: CleanPageRequest,
    request: Request,
    authorization: str = Header(default=None)
):
    user_ip = get_user_ip(request)

    # ✅ Check login
    try:
        login_status = await check_login(
            request,
            redis_get=request.app.state.redis_get,
            redis_set=request.app.state.redis_set,
            redis_incr=request.app.state.redis_incr,
            redis_expire=request.app.state.redis_expire
        )
    except HTTPException as e:
        return HTMLResponse(content=f"<h3>{e.detail}</h3>", status_code=e.status_code)
    except Exception as e:
        return HTMLResponse(content=f"<h3>Unexpected error: {str(e)}</h3>", status_code=500)

    if not isinstance(login_status, dict):
        return HTMLResponse(content=f"<h3>Login failed: {login_status}</h3>", status_code=401)

    user_id = login_status.get("user_id")
    use_cloudscraper = login_status.get("use_cloudscraper", False)
    url = body.url
    priority = queue_priority(request.state.account_type)

    # Attempting to extract Bearer token (but don't return error if missing, its an either or situation not an AND situation)
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ")[1]

    print(f"User IP: {user_ip} | User ID: {user_id} | URL: {url}")

    try:
        cleaned_html = await fetch_and_clean_page(
            url=body.url,
            user_ip=user_ip,
            unlock=body.unlock,
            http_session=request.app.state.http_session,
            redis_get=request.app.state.redis_get,
            redis_set=request.app.state.redis_set,
            use_cloudscraper=use_cloudscraper,
            fetch_limiter=request.app.state.fetch_limiter,
            queue_priority=priority,
            redis_incr=request.app.state.redis_incr,
            redis_expire=request.app.state.redis_expire  
        )

        # Only log history if token is available, unregisterred guest users beed not consume this resource
        if token:
            await save_unlock_history(user_id, url, None, request.app.state.http_session)

        return HTMLResponse(content=cleaned_html)
    except Exception as e:
        print(f"Error in fetch_and_clean_page: {e}")
        return HTMLResponse(content=f"<h1>Error loading page: {e}</h1>", status_code=500)
