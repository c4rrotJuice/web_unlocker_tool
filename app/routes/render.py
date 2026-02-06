#render.py
from fastapi import APIRouter, Request, Query, HTTPException, Header, Body
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from datetime import datetime
import uuid
import httpx
from app.routes.http import http_client

from app.services.unprotector import fetch_and_clean_page, FetchOutcome
from app.services.IP_usage_limit import check_login, get_user_ip
from app.services.entitlements import queue_priority
from app.routes.upstash_redis import redis_get, redis_set, redis_incr, redis_expire


load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
router = APIRouter()

def _wants_json_response(request: Request) -> bool:
    accept_header = (request.headers.get("accept") or "").lower()
    return "application/json" in accept_header


def _failure_json_from_outcome(outcome: FetchOutcome) -> tuple[int, dict]:
    if outcome.outcome_reason.startswith("blocked_"):
        status_code = 403
    else:
        status_code = 504 if outcome.outcome_reason == "fetch_error" else 502

    payload = {
        "success": False,
        "reason": outcome.outcome_reason,
        "provider": outcome.provider,
        "ray_id": outcome.ray_id,
        "http_status": outcome.http_status,
        "html": outcome.html,
    }
    if outcome.outcome_reason == "blocked_by_cloudflare":
        # Browser mode can complete interactive checks when server-side unlock is blocked.
        payload["suggested_action"] = "use_browser_mode"
    return status_code, payload


def _response_from_outcome(request: Request, outcome: FetchOutcome):
    if outcome.success:
        return HTMLResponse(content=outcome.html, status_code=200)
    status_code, payload = _failure_json_from_outcome(outcome)
    if _wants_json_response(request) or outcome.outcome_reason.startswith("blocked_"):
        return JSONResponse(content=payload, status_code=status_code)
    return HTMLResponse(content=outcome.html, status_code=status_code)


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

    if authorization:
        # Authenticated logic
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
            token = authorization.split(" ")[1]
            outcome = await fetch_and_clean_page(
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
            await save_unlock_history(
                user_id,
                url,
                token,
                request.app.state.http_session,
                success=outcome.success,
                status=outcome.http_status,
                block_reason=None if outcome.success else outcome.outcome_reason,
                provider=outcome.provider,
                ray_id=outcome.ray_id,
            )
            return _response_from_outcome(request, outcome)
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
            outcome = await fetch_and_clean_page(
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

            return _response_from_outcome(request, outcome)
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

    if authorization:
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
            token = authorization.split(" ")[1]
            outcome = await fetch_and_clean_page(
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
            await save_unlock_history(
                user_id,
                url,
                token,
                request.app.state.http_session,
                success=outcome.success,
                status=outcome.http_status,
                block_reason=None if outcome.success else outcome.outcome_reason,
                provider=outcome.provider,
                ray_id=outcome.ray_id,
            )
            return _response_from_outcome(request, outcome)
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
        outcome = await fetch_and_clean_page(
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
        return _response_from_outcome(request, outcome)
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
    success: bool = True,
    status: int | None = None,
    block_reason: str | None = None,
    provider: str | None = None,
    ray_id: str | None = None,
) -> str:
    payload = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "url": url,
        "unlocked_at": datetime.utcnow().isoformat(),
        "source": source,
        "event_id": event_id,
        "success": success,
        "status": status,
        "block_reason": block_reason,
        "provider": provider,
        "ray_id": ray_id,
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

    if res.status_code == 400:
        try:
            err_text = (res.text or "").lower()
        except Exception:
            err_text = ""
        if all(fragment in err_text for fragment in ["column", "unlock_history"]):
            fallback_payload = {
                "id": payload["id"],
                "user_id": payload["user_id"],
                "url": payload["url"],
                "unlocked_at": payload["unlocked_at"],
                "source": payload["source"],
                "event_id": payload["event_id"],
            }
            res = await client.post(
                f"{SUPABASE_URL}/rest/v1/unlock_history",
                params=params,
                headers=headers,
                json=fallback_payload,
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
        outcome = await fetch_and_clean_page(
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
            await save_unlock_history(
                user_id,
                url,
                token,
                request.app.state.http_session,
                success=outcome.success,
                status=outcome.http_status,
                block_reason=None if outcome.success else outcome.outcome_reason,
                provider=outcome.provider,
                ray_id=outcome.ray_id,
            )

        return _response_from_outcome(request, outcome)
    except Exception as e:
        print(f"Error in fetch_and_clean_page: {e}")
        return HTMLResponse(content=f"<h1>Error loading page: {e}</h1>", status_code=500)
