#search.py
from fastapi import APIRouter, HTTPException, Query, Request
import os
import logging
from app.routes.http import http_client
from app.services.entitlements import can_use_history_search, normalize_account_type
from app.services.metrics import metrics, record_dependency_call_async

router = APIRouter()
logger = logging.getLogger(__name__)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


@router.get("/api/history")
async def get_full_history(
    request: Request,
    q: str = Query(None, description="Search query for URL"),
    limit: int = Query(50, le=200, description="Max number of results"),
):
    request_id = getattr(request.state, "request_id", "unknown")
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail={"code": "AUTH_MISSING", "message": "Missing or invalid token"})

    account_type = normalize_account_type(request.state.account_type)
    if not can_use_history_search(account_type):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "HISTORY_SEARCH_TIER_LOCKED",
                "message": "History search requires Standard or higher.",
                "toast": "Upgrade to Standard to search history.",
            },
        )

    # Build filter for Supabase
    filter_str = f"user_id=eq.{user_id}"
    if q:
        filter_str += f"&url.ilike.%25{q}%25"

    try:
        res = await record_dependency_call_async(
            "supabase",
            lambda: http_client.get(
                f"{SUPABASE_URL}/rest/v1/unlock_history?{filter_str}&order=unlocked_at.desc&limit={limit}",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                },
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("history.fetch_exception request_id=%s user_id=%s", request_id, user_id)
        raise HTTPException(
            status_code=503,
            detail={"code": "HISTORY_DEPENDENCY_ERROR", "message": "History is temporarily unavailable.", "request_id": request_id},
        ) from exc

    if res.status_code != 200:
        logger.error(
            "history.fetch_failed request_id=%s user_id=%s status=%s body_snip=%s",
            request_id,
            user_id,
            res.status_code,
            (res.text or "")[:220],
        )
        metrics.inc("api.upstream.error_count")
        raise HTTPException(
            status_code=503,
            detail={"code": "HISTORY_FETCH_FAILED", "message": "History is temporarily unavailable.", "request_id": request_id},
        )

    return res.json()
