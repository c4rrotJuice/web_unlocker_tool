#IP_usage_limit.py


import os
import hashlib
from datetime import datetime, timedelta
import pytz
from fastapi import Request, HTTPException

from app.routes.http import http_client
from app.routes.upstash_redis import redis_get, redis_set, redis_incr, redis_expire
from app.services.entitlements import (
    can_use_cloudscraper,
    has_daily_limit,
    normalize_account_type,
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

SUPABASE_TABLE = "ip_usage"
DEV_HASH = os.getenv("DEV_HASH")

MAX_DAILY_USES = 5
MAX_WEEKLY_USES = 200
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

def get_week_start_gmt3() -> str:
    today = datetime.now(pytz.timezone("Africa/Kampala")).date()
    week_start = today - timedelta(days=today.weekday())
    return week_start.isoformat()

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

async def is_rate_limited(ip: str, redis_incr, redis_expire) -> bool:
    key = f"rate_limit:{ip}"
    count = int(await redis_incr(key) or 0)

    if count == 1:
        await redis_expire(key, 60)

    return count > RATE_LIMIT_PER_MINUTE


async def is_rate_limited_user(user_id: str, redis_incr, redis_expire) -> bool:
    key = f"rate_limit:user:{user_id}"
    count = int(await redis_incr(key) or 0)

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


async def can_use_tool_ip(
    request: Request,
    redis_incr,
    redis_expire,
):
    ip = get_user_ip(request)
    hashed = hash_ip(ip)
    today = get_today_gmt3()

    if hashed == DEV_HASH:
        return True

    if await is_rate_limited(ip, redis_incr, redis_expire):
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
        account_type = normalize_account_type(request.state.account_type)
        daily_limit = request.state.usage_limit or MAX_DAILY_USES
        week_start = get_week_start_gmt3()

        if await is_rate_limited_user(user_id, redis_incr, redis_expire):
            raise HTTPException(
                status_code=429,
                detail="⏱️ Too many requests. Please slow down.",
            )

        if not has_daily_limit(account_type):
            weekly_key = f"user_usage_week:{user_id}:{week_start}"
            current_weekly = int(await redis_get(weekly_key,) or 0)
            if current_weekly >= MAX_WEEKLY_USES:
                raise HTTPException(
                    status_code=429,
                    detail="🚫 Weekly limit reached. Try again next week.",
                )

            await redis_incr(weekly_key)
            if current_weekly == 0:
                await redis_expire(weekly_key, 7 * 86400)

            return {
                "use_cloudscraper": can_use_cloudscraper(account_type),
                "user_id": user_id,
                "reason": "Paid tier user",
            }

        # Freemium user (Redis-based)
        usage_key = f"user_usage:{user_id}:{today}"
        current = int(await redis_get(usage_key,) or 0)

        if current >= daily_limit:
            raise HTTPException(
                status_code=429,
                detail="🚫 Daily limit reached. Upgrade to Standard.",
            )

        await redis_incr(usage_key)
        if current == 0:
            await redis_expire(usage_key, 86400)

        return {
            "use_cloudscraper": can_use_cloudscraper(account_type),
            "user_id": user_id,
            "reason": "Free usage logged",
        }

    # ── GUEST USER (IP) ──
    await can_use_tool_ip(request, redis_incr, redis_expire)
    return {
        "use_cloudscraper": False,
        "user_id": None,
        "reason": "Guest IP usage",
    }

