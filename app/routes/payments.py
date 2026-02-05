# payments.py
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
import hashlib
import hmac
import json
from app.routes.http import http_client
import os

router = APIRouter()

PADDLE_API_KEY = os.getenv("PADDLE_API")
PADDLE_ENV = os.getenv("PADDLE_ENV", "sandbox")
PADDLE_API_VERSION = os.getenv("PADDLE_API_VERSION", "1")
PADDLE_CLIENT_TOKEN_NAME = os.getenv(
    "PADDLE_CLIENT_TOKEN_NAME",
    "web-unlocker",
)
PADDLE_WEBHOOK_SECRET = os.getenv("PADDLE_WEBHOOK_SECRET")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

PLAN_PRICE_IDS = {
    "standard": {
        "monthly": "pri_01kf77v5j5j1b0fkwb95p0wxew",
        "quarterly": "pri_01kf77xyfjdh0rr66caz2dnye7",
    },
    "pro": {
        "monthly": "pri_01kf781jrxcwtg70bxky3316fr",
        "quarterly": "pri_01kf7839fptpnr6wtgwcnkwe1r",
    },
}

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


def _parse_iso_datetime(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None
    return parsed.isoformat().replace("+00:00", "Z")


def _extract_subscription_period_end(payload: dict) -> str | None:
    period = payload.get("current_billing_period") or payload.get("currentBillingPeriod") or {}
    if isinstance(period, dict):
        end = period.get("ends_at") or period.get("endsAt")
        if end:
            return end
    return payload.get("next_billed_at") or payload.get("nextBilledAt")


def _extract_customer_details(payload: dict) -> tuple[str | None, str | None]:
    customer_id = payload.get("customer_id") or payload.get("customerId")
    customer_email = payload.get("customer_email") or payload.get("customerEmail")

    customer = payload.get("customer")
    if isinstance(customer, dict):
        customer_id = customer_id or customer.get("id")
        customer_email = customer_email or customer.get("email")

    return customer_id, customer_email


def _extract_custom_data(payload: dict) -> dict:
    custom_data = payload.get("custom_data") or payload.get("customData")
    if isinstance(custom_data, dict):
        return custom_data
    return {}


def _extract_subscription_id(payload: dict) -> str | None:
    return payload.get("subscription_id") or payload.get("subscriptionId") or payload.get("id")


async def _lookup_user_id(customer_id: str | None, customer_email: str | None) -> str | None:
    if not SUPABASE_URL:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured.")

    if customer_id:
        res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/user_meta",
            params={"select": "user_id", "paddle_customer_id": f"eq.{customer_id}", "limit": 1},
            headers=_supabase_headers(),
        )
        if res.status_code == 200:
            rows = res.json()
            if rows:
                return rows[0].get("user_id")

    if customer_email:
        res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/user_meta",
            params={"select": "user_id", "email": f"eq.{customer_email}", "limit": 1},
            headers=_supabase_headers(),
        )
        if res.status_code == 200:
            rows = res.json()
            if rows:
                return rows[0].get("user_id")

    return None

def _paddle_environment() -> str:
    if not PADDLE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="PADDLE_API is not configured.",
        )

    paddle_env = PADDLE_ENV.lower()
    if paddle_env not in {"sandbox", "live"}:
        raise HTTPException(
            status_code=500,
            detail="PADDLE_ENV must be 'sandbox' or 'live'.",
        )

    if paddle_env == "sandbox" and PADDLE_API_KEY.startswith("pdl_live_"):
        raise HTTPException(
            status_code=500,
            detail="Sandbox environment requires a sandbox API key.",
        )
    if paddle_env == "live" and PADDLE_API_KEY.startswith("pdl_sandbox_"):
        raise HTTPException(
            status_code=500,
            detail="Live environment requires a live API key.",
        )

    return paddle_env


def _paddle_base_url() -> str:
    paddle_env = _paddle_environment()
    if paddle_env == "sandbox":
        return "https://sandbox-api.paddle.com"
    return "https://api.paddle.com"


def _paddle_headers() -> dict[str, str]:
    paddle_version = PADDLE_API_VERSION.strip()
    if not paddle_version:
        raise HTTPException(
            status_code=500,
            detail="PADDLE_API_VERSION is not configured.",
        )
    return {
        "Authorization": f"Bearer {PADDLE_API_KEY}",
        "Content-Type": "application/json",
        "Paddle-Version": paddle_version,
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
    timestamp = parts.get("ts") or parts.get("t")
    if not timestamp:
        return False

    expected = hmac.new(
        PADDLE_WEBHOOK_SECRET.encode("utf-8"),
        f"{timestamp}:{raw_body.decode('utf-8')}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(provided, expected)

@router.get("/get_paddle_token")
async def get_paddle_token(request: Request):
    paddle_env = _paddle_environment()
    base_url = _paddle_base_url()

    url = f"{base_url}/client-tokens"
    token_name = PADDLE_CLIENT_TOKEN_NAME.strip()
    if not token_name:
        raise HTTPException(
            status_code=500,
            detail="PADDLE_CLIENT_TOKEN_NAME is not configured.",
        )
    
    headers = _paddle_headers()

    res = await http_client.post(url, headers=headers, json={"name": token_name})

    if res.status_code not in {200, 201}:
        raise HTTPException(
            status_code=res.status_code,
            detail=f"Paddle token request failed: {res.text}",
        )

    data = res.json()
    token = data.get("data", {}).get("token")
    if not token:
        raise HTTPException(status_code=500, detail="Token not found in Paddle response")

    return JSONResponse(content={"token": token, "environment": paddle_env})


@router.post("/create_paddle_checkout")
async def create_paddle_checkout(request: Request):
    if not request.state.user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not request.state.email:
        raise HTTPException(status_code=400, detail="Customer email is required.")

    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    plan = (payload.get("plan") or "").strip().lower()
    cycle = (payload.get("cycle") or "").strip().lower()
    price_id = PLAN_PRICE_IDS.get(plan, {}).get(cycle)
    if not price_id:
        raise HTTPException(
            status_code=400,
            detail="Invalid plan or billing cycle.",
        )

    transaction_payload = {
        "items": [
            {
                "price_id": price_id,
                "quantity": 1,
            }
        ],
        "customer": {
            "email": request.state.email,
        },
        "custom_data": {
            "user_id": request.state.user_id,
            "plan": plan,
            "cycle": cycle,
        },
    }

    url = f"{_paddle_base_url()}/transactions"
    res = await http_client.post(
        url,
        headers=_paddle_headers(),
        json=transaction_payload,
    )

    if res.status_code not in {200, 201}:
        raise HTTPException(
            status_code=res.status_code,
            detail=f"Paddle transaction request failed: {res.text}",
        )

    data = res.json()
    transaction_id = data.get("data", {}).get("id")
    if not transaction_id:
        raise HTTPException(
            status_code=500,
            detail="Transaction ID not found in Paddle response.",
        )

    return JSONResponse(content={"transaction_id": transaction_id})


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
    custom_data = _extract_custom_data(data)
    customer_id, customer_email = _extract_customer_details(data)
    subscription_id = _extract_subscription_id(data)
    user_id = custom_data.get("user_id") or await _lookup_user_id(customer_id, customer_email)

    if not user_id:
        return JSONResponse(
            content={"status": "ignored", "reason": "missing user_id"},
            status_code=200,
        )

    account_type = None
    paid_until = None
    auto_renew = None
    paddle_price_id = _extract_price_id(data)

    if event_type in PADDLE_CANCEL_EVENTS:
        account_type = "free"
    else:
        status = (data.get("status") or "").lower()
        if status and status not in PADDLE_ACTIVE_STATUSES:
            account_type = "free"
        else:
            account_type = PRICE_ID_TO_TIER.get(paddle_price_id)

        paid_until = _parse_iso_datetime(_extract_subscription_period_end(data))
        if event_type in {"subscription.renewed", "subscription.updated", "subscription.created"}:
            auto_renew = status not in {"canceled", "cancelled"}

    if not account_type:
        return JSONResponse(
            content={"status": "ignored", "reason": "unknown tier"},
            status_code=200,
        )

    update_payload = {
        "account_type": account_type,
        "paddle_customer_id": customer_id,
        "paddle_subscription_id": subscription_id,
        "paddle_price_id": paddle_price_id,
    }
    if paid_until:
        update_payload["paid_until"] = paid_until
    if auto_renew is not None:
        update_payload["auto_renew"] = auto_renew
    if account_type == "free":
        update_payload["paid_until"] = None

    res = await http_client.patch(
        f"{SUPABASE_URL}/rest/v1/user_meta",
        params={"user_id": f"eq.{user_id}"},
        headers={
            **_supabase_headers(),
            "Prefer": "return=representation",
        },
        json=update_payload,
    )
    if res.status_code not in {200, 204}:
        raise HTTPException(status_code=500, detail=res.text)

    cache_key = f"user_meta:{user_id}"
    try:
        await request.app.state.redis_set(
            cache_key,
            {
                "account_type": account_type,
                "paid_until": paid_until,
            },
            ttl_seconds=300,
        )
    except Exception:
        pass

    return JSONResponse(content={"status": "ok"})
