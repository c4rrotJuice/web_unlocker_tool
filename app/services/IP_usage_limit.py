#IP_usage_limit.py


import os
import hashlib
from datetime import datetime
import pytz
from fastapi import Request, HTTPException

from app.routes.http import http_client
from app.routes.upstash_redis import redis_get, redis_set, redis_incr, redis_expire

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

SUPABASE_TABLE = "ip_usage"
DEV_HASH = os.getenv("DEV_HASH")

MAX_DAILY_USES = 5
RATE_LIMIT_PER_MINUTE = 3


HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
}


# ───────────────────────────
# Helpers
# ───────────────────────────

def get_today_gmt3() -> str:
    return datetime.now(pytz.timezone("Africa/Kampala")).date().isoformat()


def hash_ip(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()


def get_user_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    return (
        forwarded.split(",")[0].strip()
        if forwarded and "," in forwarded
        else (forwarded or request.client.host)
    )


# ───────────────────────────
# Rate limiting
# ───────────────────────────

async def is_rate_limited(ip: str) -> bool:
    key = f"rate_limit:{ip}"
    result = await redis_incr(key)
    count = result.get("result", 0)

    if count == 1:
        await redis_expire(key, 60)

    return count > RATE_LIMIT_PER_MINUTE


# ───────────────────────────
# IP-based usage (guests)
# ───────────────────────────

async def log_ip_usage(hashed_ip: str, today: str) -> int:
    params = {
        "ip_address": f"eq.{hashed_ip}",
        "used_at": f"eq.{today}",
        "select": "id,usage_count",
    }

    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}",
        headers=HEADERS,
        params=params,
    )
    res.raise_for_status()
    data = res.json()

    if data:
        record = data[0]
        usage = record["usage_count"] + 1
        await http_client.patch(
            f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?id=eq.{record['id']}",
            headers=HEADERS,
            json={"usage_count": usage},
        )
    else:
        usage = 1
        await http_client.post(
            f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}",
            headers=HEADERS,
            json={
                "ip_address": hashed_ip,
                "used_at": today,
                "usage_count": usage,
            },
        )

    return usage


async def can_use_tool_ip(request: Request):
    ip = get_user_ip(request)
    hashed = hash_ip(ip)
    today = get_today_gmt3()

    if hashed == DEV_HASH:
        return True

    if await is_rate_limited(ip):
        raise HTTPException(
            status_code=429,
            detail="⏱️ Too many requests. Please slow down.",
        )

    usage = await log_ip_usage(hashed, today)

    if usage > MAX_DAILY_USES:
        raise HTTPException(
            status_code=429,
            detail="⚠️ Daily free usage limit reached.",
        )

    return True


# ───────────────────────────
# Unified access gate
# ───────────────────────────

async def check_login(request: Request, redis_get,
    redis_set,
    redis_incr,
    redis_expire) -> dict:
    """
    Unified gate:
    - Authenticated users → request.state
    - Guests → IP-based limits
    """

    today = get_today_gmt3()

    # ── AUTHENTICATED USER ──
    if request.state.user_id:
        user_id = request.state.user_id
        account_type = request.state.account_type
        daily_limit = request.state.usage_limit or MAX_DAILY_USES

        if account_type == "premium":
            return {
                "use_cloudscraper": True,
                "user_id": user_id,
                "reason": "Premium user",
            }

        # Freemium user (Redis-based)
        usage_key = f"user_usage:{user_id}:{today}"
        current = int(await redis_get(usage_key) or 0)

        if current >= daily_limit:
            raise HTTPException(
                status_code=429,
                detail="🚫 Daily limit reached. Upgrade to premium.",
            )

        await redis_incr(usage_key)
        if current == 0:
            await redis_expire(usage_key, 86400)

        return {
            "use_cloudscraper": True,
            "user_id": user_id,
            "reason": "Freemium usage logged",
        }

    # ── GUEST USER (IP) ──
    await can_use_tool_ip(request)
    return {
        "use_cloudscraper": False,
        "user_id": None,
        "reason": "Guest IP usage",
    }


