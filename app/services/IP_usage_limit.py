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


'''
import os
import hashlib
from datetime import datetime
import pytz
import httpx
from dotenv import load_dotenv
from fastapi import Request, HTTPException
from app.routes.upstash_redis import redis_get, redis_set, redis_incr, redis_expire

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_TABLE = "ip_usage"
DEV_HASH = os.getenv("DEV_HASH")
MAX_DAILY_USES = 5
RATE_LIMIT_PER_MINUTE = 3

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Tye": "application/json",
}

def get_today_gmt3() -> str:
    return datetime.now(pytz.timezone("Africa/Kampala")).date().isoformat()

def hash_ip(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()

async def is_rate_limited(ip: str, redis_incr: callable) -> bool:
    key = f"rate_limit:{ip}"
    result = await redis_incr(key)
    current = result.get("result", 0)

    if current == 1:
        await redis_expire(key, 60)  # 1 minute

    return current > RATE_LIMIT_PER_MINUTE

async def can_use_tool(ip: str, redis_get: callable, redis_set: callable) -> tuple[bool, str]:
    hashed_ip = hash_ip(ip)
    today = get_today_gmt3()

    if hash_ip(ip) == DEV_HASH:
        print("✅ DEV_HASH matched. Bypassing limit.")
        try:
            await log_usage(hashed_ip, today)
        except Exception as e:
            print(f"⚠️ Logging failed for DEV_HASH user: {e}")
        return True, ""

    if await is_rate_limited(ip, redis_incr):
        return False, "⏱️ You're sending requests too fast. Please slow down and try again."

    try:
        usage_count = await log_usage(hashed_ip, today)
    except Exception as e:
        print(f"🛑 Logging error: {e}")
        return False, "🔧 Error tracking usage. Try again later."

    if usage_count > MAX_DAILY_USES:
        return False, (
            "⚠️ Sorry, your daily 5 usage counts have been exhausted.\n"
            "Please come again tomorrow or upgrade to premium for unlimited access."
        )

    return True, ""

async def log_usage(hashed_ip: str, today: str) -> int:
    async with httpx.AsyncClient() as client:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"
        params = {
            "ip_address": f"eq.{hashed_ip}",
            "used_at": f"eq.{today}",
            "select": "id,usage_count",
        }

        response = await client.get(url, headers=headers, params=params)
        response.raise_for_status()
        data = response.json()

        if data:
            record = data[0]
            usage_count = record["usage_count"] + 1
            patch_url = f"{url}?id=eq.{record['id']}"
            patch_body = {"usage_count": usage_count}
            await client.patch(patch_url, headers=headers, json=patch_body)
        else:
            usage_count = 1
            new_record = {
                "ip_address": hashed_ip,
                "used_at": today,
                "usage_count": usage_count,
            }
            await client.post(url, headers=headers, json=new_record)

        return usage_count

# New: Unified check_login() for auth/IP logic
async def check_login(request: Request, redis_get, redis_set, redis_incr, redis_expire) -> dict:
    use_cloudscraper = False
    user_id = None
    today = get_today_gmt3()

    # Step 1: Check for Bearer token
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        # IP-based fallback
        ip = get_user_ip(request)
        allowed, reason = await can_use_tool(ip, redis_get, redis_set)
        if not allowed:
            raise HTTPException(status_code=429, detail=reason)
        return {"use_cloudscraper": False, "user_id": None, "reason": reason}

    token = auth_header.split(" ")[1]

    # Step 2: Verify access token
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY}
            )
        if res.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        user_data = res.json()
        user_id = user_data["id"]
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth check failed: {e}")

    use_cloudscraper = True

    # Step 3: Fetch user_meta
    try:
    
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
}
        res = await httpx.AsyncClient().get(
            f"{SUPABASE_URL}/rest/v1/user_meta?user_id=eq.{user_id}&select=account_type,daily_limit",
            headers=headers
        )
        print("🧾 Supabase Meta Raw Response:", res.status_code, res.text)
        res.raise_for_status()
        meta = res.json()
        if not meta:
            raise HTTPException(status_code=404, detail="User metadata not found")
        account_type = meta[0]["account_type"]
        daily_limit = meta[0].get("daily_limit", 5)
    except Exception as e:
        print("🧾 Supabase Meta Raw Response:", res.status_code, res.text)
        raise HTTPException(status_code=500, detail=f"Failed to fetch user metadata: {e}")

    if account_type == "premium":
        return {"use_cloudscraper": True, "user_id": user_id, "reason": "Premium user"}

    # Step 4: Freemium usage limit via Redis
    usage_key = f"user_usage:{user_id}:{today}"
    result = await redis_get(usage_key)
    current_usage = int(result) if result is not None else 0

    if current_usage >= daily_limit:
        raise HTTPException(status_code=429, detail="🚫 Freemium daily limit reached.")

    await redis_incr(usage_key)
    if current_usage == 0:
        await redis_expire(usage_key, 86400)  # 24h

    return {"use_cloudscraper": True, "user_id": user_id, "reason": "Freemium user - usage logged"}

# Helper
def get_user_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    return forwarded.split(",")[0].strip() if forwarded and "," in forwarded else (forwarded or request.client.host)

'''