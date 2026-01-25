# payments.py
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import hashlib
import hmac
import json
from app.routes.http import http_client
import os

router = APIRouter()

PADDLE_API_KEY = os.getenv("PADDLE_API")
PADDLE_ENV = os.getenv("PADDLE_ENV", "sandbox")
PADDLE_API_VERSION = os.getenv("PADDLE_API_VERSION", "1")
PADDLE_WEBHOOK_SECRET = os.getenv("PADDLE_WEBHOOK_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

PRICE_ID_TO_TIER = {
    "pri_01kf77v5j5j1b0fkwb95p0wxew": "standard",
    "pri_01kf77xyfjdh0rr66caz2dnye7": "standard",
    "pri_01kf781jrxcwtg70bxky3316fr": "pro",
    "pri_01kf7839fptpnr6wtgwcnkwe1r": "pro",
}

PADDLE_ACTIVE_STATUSES = {"active", "trialing", "past_due"}
PADDLE_CANCEL_EVENTS = {
    "subscription.canceled",
    "subscription.cancelled",
    "subscription.deleted",
    "subscription.ended",
}


def _supabase_headers() -> dict[str, str]:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase service role key missing.",
        )
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def _extract_price_id(payload: dict) -> str | None:
    items = payload.get("items") or []
    if isinstance(items, list) and items:
        item = items[0] or {}
        if isinstance(item, dict):
            price_id = item.get("price_id") or item.get("priceId")
            if price_id:
                return price_id
            price = item.get("price")
            if isinstance(price, dict):
                return price.get("id")
    return payload.get("price_id") or payload.get("priceId")


def _verify_paddle_signature(raw_body: bytes, signature_header: str) -> bool:
    if not PADDLE_WEBHOOK_SECRET:
        return True
    if not signature_header:
        return False
    parts = dict(
        part.strip().split("=", 1)
        for part in signature_header.split(",")
        if "=" in part
    )
    provided = parts.get("v1") or parts.get("h1") or parts.get("sig")
    if not provided:
        return False
    expected = hmac.new(
        PADDLE_WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(provided, expected)

@router.get("/get_paddle_token")
async def get_paddle_token():
    if not PADDLE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="PADDLE_API is not configured.",
        )

    base_url = "https://api.paddle.com"
    if PADDLE_ENV.lower() == "sandbox":
        base_url = "https://sandbox-api.paddle.com"

    url = f"{base_url}/client-tokens"
    paddle_version = PADDLE_API_VERSION.strip()
    if not paddle_version:
        raise HTTPException(
            status_code=500,
            detail="PADDLE_API_VERSION is not configured.",
        )

    headers = {
        "Authorization": f"Bearer {PADDLE_API_KEY}",
        "Content-Type": "application/json",
        "Paddle-Version": paddle_version,
    }

    res = await http_client.post(url, headers=headers, json={})

    if res.status_code != 200:
        raise HTTPException(
            status_code=res.status_code,
            detail=f"Paddle token request failed: {res.text}",
        )

    data = res.json()
    token = data.get("data", {}).get("token")
    if not token:
        raise HTTPException(status_code=500, detail="Token not found in Paddle response")

    return JSONResponse(content={"token": token})


@router.get("/api/me")
async def get_current_user(request: Request):
    if not request.state.user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {
        "user_id": request.state.user_id,
        "account_type": request.state.account_type,
    }


@router.post("/webhooks/paddle")
async def paddle_webhook(request: Request):
    raw_body = await request.body()
    signature = request.headers.get("Paddle-Signature", "")

    if PADDLE_WEBHOOK_SECRET and not _verify_paddle_signature(raw_body, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    event_type = payload.get("event_type") or payload.get("eventType")
    data = payload.get("data") or {}
    custom_data = data.get("custom_data") or data.get("customData") or {}
    user_id = custom_data.get("user_id")

    if not user_id:
        return JSONResponse(
            content={"status": "ignored", "reason": "missing user_id"},
            status_code=200,
        )

    account_type = None
    if event_type in PADDLE_CANCEL_EVENTS:
        account_type = "free"
    else:
        status = (data.get("status") or "").lower()
        if status and status not in PADDLE_ACTIVE_STATUSES:
            account_type = "free"
        else:
            price_id = _extract_price_id(data)
            account_type = PRICE_ID_TO_TIER.get(price_id)

    if not account_type:
        return JSONResponse(
            content={"status": "ignored", "reason": "unknown tier"},
            status_code=200,
        )

    res = await http_client.patch(
        f"{SUPABASE_URL}/rest/v1/user_meta",
        params={"user_id": f"eq.{user_id}"},
        headers={
            **_supabase_headers(),
            "Prefer": "return=representation",
        },
        json={"account_type": account_type},
    )
    if res.status_code not in {200, 204}:
        raise HTTPException(status_code=500, detail=res.text)

    cache_key = f"user_meta:{user_id}"
    try:
        await request.app.state.redis_set(
            cache_key,
            {"account_type": account_type},
            ttl_seconds=300,
        )
    except Exception:
        pass

    return JSONResponse(content={"status": "ok"})
