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

def _check_env():
    if not UPSTASH_REDIS_REST_URL or not UPSTASH_REDIS_REST_TOKEN:
        raise RuntimeError("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN")

headers = {
    "Authorization": f"Bearer {UPSTASH_REDIS_REST_TOKEN}",
    "Content-Type": "application/json",
}

def compress_for_storage(data: str) -> str:
    return base64.b64encode(zlib.compress(data.encode())).decode()

def decompress_from_storage(data: str) -> str:
    try:
        return zlib.decompress(base64.b64decode(data.encode())).decode()
    except Exception:
        return data

async def _cmd(client: httpx.AsyncClient, command: list):
    _check_env()
    r = await client.post(UPSTASH_REDIS_REST_URL, headers=headers, json=command, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"Upstash command failed {r.status_code}: {r.text}")
    return r.json().get("result")

async def redis_get(key: str, client: httpx.AsyncClient):
    try:
        raw = await _cmd(client, ["GET", key])
        if raw is None:
            return None
        if isinstance(raw, str) and raw.startswith("__COMPRESSED__:"):
            raw = decompress_from_storage(raw.replace("__COMPRESSED__:", "", 1))
        try:
            return json.loads(raw)
        except Exception:
            return raw
    except Exception as e:
        print(f"[ERROR] [redis_get] key={key} exc={repr(e)}")
        raise

async def redis_set(key: str, value: str | dict, client: httpx.AsyncClient, ttl_seconds: int | None = None):
    if not isinstance(value, str):
        value = json.dumps(value)

    if len(value) > 5000:
        value = "__COMPRESSED__:" + compress_for_storage(value)

    cmd = ["SET", key, value]
    if ttl_seconds:
        cmd += ["EX", str(ttl_seconds)]

    return await _cmd(client, cmd)

async def redis_incr(key: str, client: httpx.AsyncClient):
    return await _cmd(client, ["INCR", key])

async def redis_expire(key: str, seconds: int, client: httpx.AsyncClient):
    return await _cmd(client, ["EXPIRE", key, str(seconds)])
