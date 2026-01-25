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

        print(f"[🔒 AUTH] User ID: {user_id} | IP: {user_ip} | Unlock: True")

        try:
            token = authorization.split(" ")[1]
            cleaned_html = await fetch_and_clean_page(
                url=url,
                user_ip=user_ip,
                unlock=unlock,
                http_session=request.app.state.http_session,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                use_cloudscraper=use_cloudscraper,
                fetch_semaphore=request.app.state.fetch_semaphore,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire
            )
            await save_unlock_history(user_id, url, token, request.app.state.http_session)
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
            cleaned_html = await fetch_and_clean_page(
                url=url,
                user_ip=user_ip,
                unlock=unlock,
                http_session=request.app.state.http_session,
                redis_get=request.app.state.redis_get,
                redis_set=request.app.state.redis_set,
                use_cloudscraper=False,  # guest users
                fetch_semaphore=request.app.state.fetch_semaphore,
                redis_incr=request.app.state.redis_incr,
                redis_expire=request.app.state.redis_expire
            )
            
            return HTMLResponse(content=cleaned_html)
        except HTTPException as e:
            return HTMLResponse(content=f"<h3>{e.detail}</h3>", status_code=e.status_code)            
        except Exception as e:
            print(f"Error in fetch_and_clean_page: {e}")
            return HTMLResponse(content=f"<h1>Error loading page (guest): {e}</h1>", status_code=500)


async def save_unlock_history(user_id: str, url: str, token: str, client: httpx.AsyncClient):
    res = await client.post(
        f"{SUPABASE_URL}/rest/v1/unlock_history",
        headers={
            "apikey": SUPABASE_KEY,                   # Needed for Supabase
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
,       # User's token, not service key
            "Content-Type": "application/json"
        },
        json={
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "url": url,
            "unlocked_at": datetime.utcnow().isoformat()
        }
    )
    print(f"Insert status: {res.status_code}, body: {res.text}")


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
            fetch_semaphore=request.app.state.fetch_semaphore,
            redis_incr=request.app.state.redis_incr,
            redis_expire=request.app.state.redis_expire  
        )

        # Only log history if token is available, unregisterred guest users beed not consume this resource
        if token:
            await save_unlock_history(user_id, url, token, request.app.state.http_session)

        return HTMLResponse(content=cleaned_html)
    except Exception as e:
        print(f"Error in fetch_and_clean_page: {e}")
        return HTMLResponse(content=f"<h1>Error loading page: {e}</h1>", status_code=500)


