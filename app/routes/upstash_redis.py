# upstash_redis.py
import httpx
import json
import logging
import os
import zlib
import base64
from dotenv import load_dotenv

load_dotenv()

UPSTASH_REDIS_REST_URL = os.getenv("UPSTASH_REDIS_REST_URL")
UPSTASH_REDIS_REST_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN")

headers = {
    "Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}",
    "Content-Type": "application/json"
}

# ---------------------------------------------------

# --- Setting up Logging, because console.log can only take me so far ---
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


# --- Helper functions for compression, found out the hard way webpages can be heavy ---
def compress_for_storage(data: str) -> str:
    """Compress string and encode as base64 for safe storage."""
    return base64.b64encode(zlib.compress(data.encode())).decode()


def decompress_from_storage(data: str) -> str:
    """Decode base64 and decompress back into string."""
    try:
        return zlib.decompress(base64.b64decode(data.encode())).decode()
    except Exception:
        # If not compressed, just return as-is
        return data


# ---------------------------------------------------

async def redis_set(key: str, value: dict | str, ttl_seconds: int | None = None):
    """Set key to value in Redis,
    with optional TTL ( thinking 24 hours coz had trouble with cached news sites
    not updating and returnig the same image ove and over again)."""

    if not isinstance(value, str):
        value = json.dumps(value)

    # Compress large values (those HTML pages can get pretty big)
    if len(value) > 5000:  # ~5KB threshold, tweak as needed, during testing this worked for me
        value = "__COMPRESSED__:" + compress_for_storage(value)

    command = ["SET", key, value]
    if ttl_seconds:
        command += ["EX", str(ttl_seconds)]

    async with httpx.AsyncClient() as client:
        response = await client.post(
            UPSTASH_REDIS_REST_URL, headers=headers, json=command
        )
        try:
            return response.json()
        except Exception as e:
            logger.error(
                f"[redis_set] JSON decode error: {e} | Status: {response.status_code} | Body: {response.text}"
            )
            return None


async def redis_get(key: str):
    """Get key from Redis and auto-decode JSON or decompression if needed."""
    command = ["GET", key]

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                UPSTASH_REDIS_REST_URL, headers=headers, json=command
            )
            if response.status_code != 200:
                logger.warning(f"[redis_get] Status {response.status_code} for key '{key}'")
                return None

            data = response.json()
            raw = data.get("result")

            if raw is None:
                return None

            # Handle compression marker
            if isinstance(raw, str) and raw.startswith("__COMPRESSED__:"):
                raw = decompress_from_storage(raw.replace("__COMPRESSED__:", "", 1))

            try:
                return json.loads(raw)  #Attempting JSON decode
            except (json.JSONDecodeError, TypeError):
                return raw
        except Exception as e:
            logger.error(f"[redis_get] Exception for key '{key}': {e}")
            return None


async def redis_incr(key: str):
    """Increment a key atomically and return new value."""
    command = ["INCR", key]

    async with httpx.AsyncClient() as client:
        res = await client.post(
            UPSTASH_REDIS_REST_URL, headers=headers, json=command
        )
        return res.json()  # returns dict like {"result": 1}


async def redis_expire(key: str, seconds: int):
    """Set TTL (expire) for a key in seconds."""
    command = ["EXPIRE", key, str(seconds)]

    async with httpx.AsyncClient() as client:
        res = await client.post(
            UPSTASH_REDIS_REST_URL, headers=headers, json=command
        )
        return res.json()
