#unprotector.py
import os
import re
import asyncio
import socket
import ipaddress
import logging
import random
import hashlib
from urllib.parse import urlparse, urljoin
from datetime import datetime
import uuid
from time import perf_counter

import brotli
import httpx
import bleach
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from selectolax.parser import HTMLParser

from app.services.cloudscraper_pool import SessionPool
from app.services.priority_limiter import PriorityLimiter
from app.services.metrics import metrics, record_dependency_call_async, record_dependency_call

# --- Setup Logging ---
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

load_dotenv()

# --- Static Assets ---
BANNER_HTML = '''
<div style="background: linear-gradient(90deg, #34d399, #22c55e); color: #fff; padding: 12px; text-align: center; font-family: sans-serif; font-size: 14px; font-weight: 500; border-bottom: 1px solid #16a34a; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    ✅ This page has been unlocked. You can now freely copy and select text.
</div>
'''

BLOCKED_PAGE_HTML = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Verification Required</title>
    <style>
      body {{ font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }}
      .container {{ max-width: 720px; margin: 64px auto; background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.08); }}
      h1 {{ margin-top: 0; font-size: 24px; }}
      p {{ line-height: 1.6; margin: 12px 0; }}
      .meta {{ margin-top: 20px; padding: 16px; background: #f1f5f9; border-radius: 8px; font-size: 14px; }}
      .meta span {{ display: block; margin: 4px 0; }}
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Interactive verification required</h1>
      <p>We couldn't unlock this page because it looks like an automated protection or security check.</p>
      <p>Please visit the site directly in a browser to complete any verification steps, then try again.</p>
      <div class="meta">
        <span><strong>Hostname:</strong> {hostname}</span>
        {ray_id_block}
      </div>
    </div>
  </body>
</html>
"""

try:
    with open("app/static/unlock.js", "r") as f:
        CUSTOM_JS_SCRIPT = f.read()
except FileNotFoundError as e:
    logger.warning("Static asset missing: %s", e)
    CUSTOM_JS_SCRIPT = "console.log('Unlock script loaded.');"

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edg/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
]
ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,fr;q=0.8",
    "en-GB,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.8",
    "en-US,en;q=0.9,de;q=0.8",
]

UPGRADE_REQUIRED_HTML = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Upgrade Required</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
      .container { max-width: 720px; margin: 64px auto; background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 24px; }
      p { line-height: 1.6; margin: 12px 0; }
      .cta { margin-top: 20px; padding: 12px 16px; background: #0ea5e9; color: #fff; display: inline-block; border-radius: 8px; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Unlocking requires an upgrade</h1>
      <p>This site uses advanced protections. Upgrade to Standard or Pro for Cloudscraper-powered unlocks.</p>
      <p><a class="cta" href="/pricing">Upgrade to Standard or Pro</a></p>
    </div>
  </body>
</html>
"""

def build_referer(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme and parsed.hostname:
        return f"{parsed.scheme}://{parsed.hostname}/"
    return None

def _platform_from_user_agent(user_agent: str | None) -> str:
    if not user_agent:
        return "Windows"
    ua = user_agent.lower()
    if "mac os x" in ua:
        return "macOS"
    if "android" in ua:
        return "Android"
    if "iphone" in ua or "ipad" in ua:
        return "iOS"
    if "linux" in ua:
        return "Linux"
    return "Windows"

def _is_mobile_user_agent(user_agent: str | None) -> bool:
    if not user_agent:
        return False
    ua = user_agent.lower()
    return "mobile" in ua or "android" in ua or "iphone" in ua

def _sec_ch_ua_for_user_agent(user_agent: str | None) -> str | None:
    if not user_agent:
        return None
    ua = user_agent.lower()
    chromium_match = re.search(r"(chrome|edg|chromium)/(\d+)", ua)
    if not chromium_match:
        return None
    brand, version = chromium_match.groups()
    if brand == "edg":
        product = "Microsoft Edge"
    elif brand == "chromium":
        product = "Chromium"
    else:
        product = "Google Chrome"
    return f'"Chromium";v="{version}", "Not)A;Brand";v="8", "{product}";v="{version}"'

def build_base_headers(user_agent: str | None = None, referer: str | None = None) -> dict:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": random.choice(ACCEPT_LANGUAGES),
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
        "DNT": "1",
    }
    if user_agent:
        headers["User-Agent"] = user_agent
    if referer:
        headers["Referer"] = referer
    return headers

def build_browser_headers(user_agent: str | None, referer: str | None) -> dict:
    headers = build_base_headers(user_agent=user_agent, referer=referer)
    headers.update(
        {
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        }
    )
    sec_ch_ua = _sec_ch_ua_for_user_agent(user_agent)
    if sec_ch_ua:
        platform = _platform_from_user_agent(user_agent)
        mobile_flag = "?1" if _is_mobile_user_agent(user_agent) else "?0"
        headers.update(
            {
                "Sec-CH-UA": sec_ch_ua,
                "Sec-CH-UA-Mobile": mobile_flag,
                "Sec-CH-UA-Platform": f'"{platform}"',
            }
        )
    return headers

def _cloudscraper_header_factory(hostname: str) -> dict:
    user_agent = random.choice(USER_AGENTS)
    return build_browser_headers(user_agent=user_agent, referer=None)

def _cloudscraper_options() -> dict:
    browser = os.getenv("CLOUDSCRAPER_BROWSER", "chrome")
    platform = os.getenv("CLOUDSCRAPER_PLATFORM", "windows")
    mobile = os.getenv("CLOUDSCRAPER_MOBILE", "false").lower() == "true"
    delay = float(os.getenv("CLOUDSCRAPER_DELAY", "0"))
    return {
        "browser": {
            "browser": browser,
            "platform": platform,
            "mobile": mobile,
        },
        "delay": delay,
    }

_cloudscraper_session_pool = SessionPool(
    max_size=32,
    header_factory=_cloudscraper_header_factory,
    scraper_kwargs=_cloudscraper_options(),
)

CACHE_TTL_SECONDS = 3600
BLOCKED_PAGE_TTL_SECONDS = 600

FETCH_MAX_RETRIES = int(os.getenv("FETCH_MAX_RETRIES", "2"))
FETCH_TIMEOUT_SECONDS = float(os.getenv("FETCH_TIMEOUT_SECONDS", "15"))
FETCH_CONNECT_TIMEOUT_SECONDS = float(os.getenv("FETCH_CONNECT_TIMEOUT_SECONDS", "5"))
LOW_CONF_BLOCK_RETRY_ENABLED = os.getenv("LOW_CONF_BLOCK_RETRY_ENABLED", "false").lower() == "true"

MAX_PROCESSABLE_PAGE_BYTES = int(os.getenv("MAX_PROCESSABLE_PAGE_BYTES", "10000000"))
MAX_PARSE_PAGE_BYTES = int(os.getenv("MAX_PARSE_PAGE_BYTES", "4000000"))
SLOW_FETCH_THRESHOLD_MS = float(os.getenv("SLOW_FETCH_THRESHOLD_MS", "12000"))
DYNAMIC_FETCH_RETRY_FLOOR = int(os.getenv("DYNAMIC_FETCH_RETRY_FLOOR", "1"))
ENABLE_FETCH_AUTOTUNE = os.getenv("ENABLE_FETCH_AUTOTUNE", "true").lower() == "true"
FETCH_AUTOTUNE_EVERY_N_REQUESTS = int(os.getenv("FETCH_AUTOTUNE_EVERY_N_REQUESTS", "40"))
FETCH_CONCURRENCY_MIN = int(os.getenv("FETCH_CONCURRENCY_MIN", "2"))
FETCH_CONCURRENCY_MAX = int(os.getenv("FETCH_CONCURRENCY_MAX", "12"))


def _record_stage_timing(stage: str, started_at: float, extra: dict | None = None) -> float:
    duration_ms = (perf_counter() - started_at) * 1000
    metrics.observe_ms(f"unlock_pipeline.stage.{stage}", duration_ms)
    details = ""
    if extra:
        details = " " + " ".join(f"{k}={v}" for k, v in extra.items())
    logger.info("unlock_timing stage=%s duration_ms=%.2f%s", stage, duration_ms, details)
    return duration_ms


def _effective_retry_ceiling() -> int:
    max_retries = max(1, FETCH_MAX_RETRIES)
    p95_fetch_ms = metrics.percentile_ms("unlock_pipeline.stage.fetch", 95)
    p95_queue_ms = metrics.percentile_ms("unlock_pipeline.queue_wait", 95)
    if p95_fetch_ms >= max(SLOW_FETCH_THRESHOLD_MS, 1.0) or p95_queue_ms >= 1500:
        return max(1, min(max_retries, DYNAMIC_FETCH_RETRY_FLOOR))
    if p95_fetch_ms >= (SLOW_FETCH_THRESHOLD_MS * 0.8):
        return max(1, min(max_retries, DYNAMIC_FETCH_RETRY_FLOOR + 1))
    return max_retries


def _desired_concurrency(current: int) -> int:
    p95_fetch_ms = metrics.percentile_ms("unlock_pipeline.stage.fetch", 95)
    p95_queue_ms = metrics.percentile_ms("unlock_pipeline.queue_wait", 95)
    blocked = metrics.counter("unlock_pipeline.blocked_count")
    retries = metrics.counter("unlock_pipeline.retry_count")
    requests = max(1, metrics.counter("unlock_pipeline.request_count"))
    retry_rate = retries / requests

    desired = current
    if p95_fetch_ms > (SLOW_FETCH_THRESHOLD_MS * 1.1) or retry_rate > 0.40:
        desired = max(FETCH_CONCURRENCY_MIN, current - 1)
    elif p95_queue_ms > 700 and retry_rate < 0.20 and blocked < (requests * 0.25):
        desired = min(FETCH_CONCURRENCY_MAX, current + 1)

    return max(FETCH_CONCURRENCY_MIN, min(FETCH_CONCURRENCY_MAX, desired))


async def _maybe_autotune_fetch_controls(fetch_limiter: PriorityLimiter | None) -> None:
    if not ENABLE_FETCH_AUTOTUNE or fetch_limiter is None:
        return
    request_count = metrics.counter("unlock_pipeline.request_count")
    if request_count < 1 or request_count % max(1, FETCH_AUTOTUNE_EVERY_N_REQUESTS) != 0:
        return

    current = fetch_limiter.max_concurrency
    desired = _desired_concurrency(current)
    if desired == current:
        logger.info(
            "unlock_autotune no_change concurrency=%s p95_fetch_ms=%.1f p95_queue_ms=%.1f retry_rate=%.3f",
            current,
            metrics.percentile_ms("unlock_pipeline.stage.fetch", 95),
            metrics.percentile_ms("unlock_pipeline.queue_wait", 95),
            metrics.counter("unlock_pipeline.retry_count") / max(1, metrics.counter("unlock_pipeline.request_count")),
        )
        return

    await fetch_limiter.set_max_concurrency(desired)
    logger.warning(
        "unlock_autotune concurrency_adjusted old=%s new=%s p95_fetch_ms=%.1f p95_queue_ms=%.1f",
        current,
        desired,
        metrics.percentile_ms("unlock_pipeline.stage.fetch", 95),
        metrics.percentile_ms("unlock_pipeline.queue_wait", 95),
    )

# --- SSRF Check ---
async def is_ssrf_risk(url: str) -> bool:
    try:
        hostname = urlparse(url).hostname
        if not hostname:
            return True
        info = await asyncio.get_event_loop().getaddrinfo(hostname, None)
        ip_address_str = info[0][4][0]
        ip = ipaddress.ip_address(ip_address_str)
        return ip.is_private or ip.is_reserved or ip.is_loopback or ip.is_unspecified
    except Exception as e:
        logger.error("SSRF check failed: %s", e)
        return True

# --- Optional: HTML Sanitizer ---
def sanitize_html(html_text: str, base_url: str) -> str:
    allowed_tags = bleach.sanitizer.ALLOWED_TAGS.union({"img", "video", "source"})
    allowed_attributes = {
        **bleach.sanitizer.ALLOWED_ATTRIBUTES,
        "img": ["src", "alt"],
        "a": ["href"],
    }
    return bleach.clean(html_text, tags=allowed_tags, attributes=allowed_attributes)

# --- hash the url key to fix url too long error----
def hash_url_key(url: str, unlock: bool = True) -> str:
    hash_input = f"{url}:{unlock}".encode("utf-8")
    return hashlib.sha256(hash_input).hexdigest()

def safe_urljoin(base_url: str, value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    lowered = trimmed.lower()
    blocked_prefixes = (
        "#",
        "javascript:",
        "data:",
        "mailto:",
        "tel:",
        "blob:",
    )
    if lowered.startswith(blocked_prefixes):
        return None
    if trimmed == ":" or lowered == "about:blank":
        return None
    return urljoin(base_url, trimmed)

# --- Fix relative resource URLs ---
def rebase_html_resources(soup: BeautifulSoup, base_url: str) -> tuple[int, int]:
    num_rebased = 0
    num_skipped_invalid_url = 0
    for tag in soup.find_all("link", href=True):
        updated = safe_urljoin(base_url, tag["href"])
        if updated is None:
            num_skipped_invalid_url += 1
            continue
        tag["href"] = updated
        num_rebased += 1
    for tag in soup.find_all("script", src=True):
        updated = safe_urljoin(base_url, tag["src"])
        if updated is None:
            num_skipped_invalid_url += 1
            continue
        tag["src"] = updated
        num_rebased += 1
    for tag in soup.find_all("img", src=True):
        updated = safe_urljoin(base_url, tag["src"])
        if updated is None:
            num_skipped_invalid_url += 1
            continue
        tag["src"] = updated
        num_rebased += 1
    for tag in soup.find_all(["iframe", "audio", "video", "source"], src=True):
        updated = safe_urljoin(base_url, tag["src"])
        if updated is None:
            num_skipped_invalid_url += 1
            continue
        tag["src"] = updated
        num_rebased += 1
    for tag in soup.find_all("a", href=True):
        updated = safe_urljoin(base_url, tag["href"])
        if updated is None:
            num_skipped_invalid_url += 1
            continue
        tag["href"] = updated
        num_rebased += 1
    for tag in soup.find_all("form", action=True):
        updated = safe_urljoin(base_url, tag["action"])
        if updated is None:
            num_skipped_invalid_url += 1
            continue
        tag["action"] = updated
        num_rebased += 1
    return num_rebased, num_skipped_invalid_url
        
def patch_lazy_loaded_images(soup):
    for img in soup.find_all("img"):
        if img.has_attr("data-src") and not img.has_attr("src"):
            img["src"] = img["data-src"]
        elif img.has_attr("data-lazy-src") and not img.has_attr("src"):
            img["src"] = img["data-lazy-src"]
        elif img.has_attr("data-original") and not img.has_attr("src"):
            img["src"] = img["data-original"]

def rebase_html_resources_selectolax(tree: HTMLParser, base_url: str) -> tuple[int, int]:
    num_rebased = 0
    num_skipped_invalid_url = 0
    tag_attr_pairs = [
        ("link", "href"),
        ("script", "src"),
        ("img", "src"),
        ("iframe", "src"),
        ("audio", "src"),
        ("video", "src"),
        ("source", "src"),
        ("a", "href"),
        ("form", "action"),
    ]
    for tag, attr in tag_attr_pairs:
        for node in tree.css(tag):
            value = node.attributes.get(attr)
            if value:
                updated = safe_urljoin(base_url, value)
                if updated is None:
                    num_skipped_invalid_url += 1
                    continue
                node.attributes[attr] = updated
                num_rebased += 1
    return num_rebased, num_skipped_invalid_url

def patch_lazy_loaded_images_selectolax(tree: HTMLParser) -> None:
    for node in tree.css("img"):
        if "src" in node.attributes:
            continue
        data_src = node.attributes.get("data-src")
        data_lazy_src = node.attributes.get("data-lazy-src")
        data_original = node.attributes.get("data-original")
        if data_src:
            node.attributes["src"] = data_src
        elif data_lazy_src:
            node.attributes["src"] = data_lazy_src
        elif data_original:
            node.attributes["src"] = data_original

def extract_doctype(html_text: str) -> str | None:
    match = re.search(r"<!doctype[^>]*>", html_text, flags=re.IGNORECASE)
    return match.group(0) if match else None

def _extract_charset(content_type: str | None) -> str | None:
    if not content_type:
        return None
    match = re.search(r"charset=([^\s;]+)", content_type, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip("\"'")

def _decode_response_body(body: bytes, headers: dict, encoding_hint: str | None) -> str:
    content_encoding = str(headers.get("Content-Encoding", "")).lower()
    decoded_body = body
    if "br" in content_encoding:
        try:
            decoded_body = brotli.decompress(body)
            logger.info(
                "Brotli decompressed response from %s to %s bytes",
                len(body),
                len(decoded_body),
            )
        except brotli.error as e:
            logger.warning("Brotli decompression failed: %s", e)
        except Exception as e:
            logger.warning("Unexpected Brotli decompression error: %s", e)

    content_type = headers.get("Content-Type", "")
    charset = _extract_charset(content_type) or encoding_hint or "utf-8"
    try:
        return decoded_body.decode(charset, errors="replace")
    except LookupError:
        return decoded_body.decode("utf-8", errors="replace")

def should_fallback_selectolax(original_html: str, parsed_html: str) -> bool:
    original = original_html.lower()
    parsed = parsed_html.lower()
    required_tags = ["<html", "<head", "<body"]
    for tag in required_tags:
        if tag in original and tag not in parsed:
            return True
    if parsed_html.strip() == "":
        return True
    if len(parsed_html) < int(len(original_html) * 0.7):
        return True
    return False

def apply_dom_cleanups(tree: HTMLParser) -> int:
    num_scripts_removed = 0
    blocker_patterns = [
        r"document\.oncopy\s*=",
        r"document\.oncontextmenu\s*=",
        r"document\.onselectstart\s*=",
        r"document\.oncut\s*=",
        r"window\.oncopy\s*=",
        r"window\.oncontextmenu\s*=",
        r"window\.onselectstart\s*=",
        r"window\.oncut\s*=",
    ]
    for script in tree.css('script'):
        try:
            src = script.attributes.get("src", "")
            if "gtag" in src or "analytics" in src or "json" in script.attributes.get("type", ""):
                continue
            if src:
                continue
            script_text = script.text() or ""
            if len(script_text) < 8000 and any(
                re.search(pattern, script_text, flags=re.IGNORECASE) for pattern in blocker_patterns
            ):
                script.decompose()
                num_scripts_removed += 1
        except Exception as e:
            logger.warning("Script removal error: %s", e)

    restrictive_events = {"oncopy", "oncut", "oncontextmenu", "onselectstart", "onmousedown"}
    for el in tree.css('*'):
        try:
            for attr in list(el.attributes.keys()):
                if attr.lower() in restrictive_events:
                    del el.attributes[attr]
        except Exception as e:
            logger.warning("Inline JS cleanup error: %s", e)
    return num_scripts_removed

def strip_integrity_attributes(tree: HTMLParser) -> int:
    attributes_to_strip = {"integrity", "crossorigin", "referrerpolicy"}
    num_stripped = 0
    for el in tree.css("*"):
        for attr in list(el.attributes.keys()):
            if attr.lower() in attributes_to_strip:
                del el.attributes[attr]
                num_stripped += 1
    return num_stripped

def _serialize_style_attributes(attributes: dict) -> str:
    parts = []
    for key, value in attributes.items():
        if value is None:
            parts.append(key)
        else:
            escaped = str(value).replace('"', "&quot;")
            parts.append(f'{key}="{escaped}"')
    return " ".join(parts)

def apply_font_simplification(tree: HTMLParser) -> dict:
    removed_font_links = 0
    removed_font_preloads = 0
    stripped_font_face_blocks = 0
    removed_google_font_links = 0

    font_link_pattern = re.compile(r"\.(woff2?|ttf|otf)(\?.*)?$", flags=re.IGNORECASE)
    font_face_pattern = re.compile(r"@font-face\s*{.*?}", flags=re.IGNORECASE | re.DOTALL)

    for link in tree.css("link"):
        href = link.attributes.get("href", "")
        rel = link.attributes.get("rel", "")
        rel_lower = rel.lower()
        as_attr = link.attributes.get("as", "")
        href_lower = href.lower()
        if "preload" in rel_lower and as_attr.lower() == "font":
            link.decompose()
            removed_font_preloads += 1
            continue
        if href and font_link_pattern.search(href):
            link.decompose()
            removed_font_links += 1
            continue
        if "stylesheet" in rel_lower and href:
            if "fonts.googleapis.com" in href_lower or "typekit" in href_lower:
                link.decompose()
                removed_google_font_links += 1

    for style in tree.css("style"):
        css_text = style.text() or ""
        if "@font-face" not in css_text.lower():
            continue
        updated_text = css_text
        block_count = 0
        while True:
            updated_text, replacements = font_face_pattern.subn("", updated_text)
            if replacements == 0:
                break
            block_count += replacements
        if block_count:
            stripped_font_face_blocks += block_count
            attributes = style.attributes
            attrs_serialized = _serialize_style_attributes(attributes)
            if attrs_serialized:
                style_html = f"<style {attrs_serialized}>{updated_text}</style>"
            else:
                style_html = f"<style>{updated_text}</style>"
            replacement = HTMLParser(style_html).css_first("style")
            if replacement is not None:
                style.replace_with(replacement)

    override_style = (
        '<style id="unlocker-font-override">'
        'html,body,*{font-family:system-ui,-apple-system,"Segoe UI",Roboto,'
        '"Helvetica Neue",Arial,"Noto Sans","Liberation Sans",sans-serif !important;}'
        "</style>"
    )
    override_node = HTMLParser(override_style).css_first("style")
    if override_node is not None:
        head = tree.css_first("head")
        if head is not None:
            head.insert_child(override_node)
        else:
            first_child = tree.root.child
            if first_child is not None:
                first_child.insert_before(override_node)
            else:
                tree.root.insert_child(override_node)

    return {
        "removed_font_links": removed_font_links,
        "removed_font_preloads": removed_font_preloads,
        "stripped_font_face_blocks": stripped_font_face_blocks,
        "removed_google_font_links": removed_google_font_links,
    }

def _normalize_headers(headers: dict | None) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in (headers or {}).items():
        if key is None:
            continue
        normalized[str(key).lower()] = str(value)
    return normalized


def _detect_provider(headers: dict[str, str]) -> str | None:
    server = headers.get("server", "").lower()
    if "cloudflare" in server or "cf-ray" in headers or "cf-cache-status" in headers:
        return "cloudflare"
    if "litespeed" in server:
        return "litespeed"
    if "akamai" in server or "akamai" in headers.get("x-akamai-transformed", "").lower():
        return "akamai"
    if "perimeterx" in server or "x-px" in " ".join(headers.keys()):
        return "perimeterx"
    return "unknown"


def classify_blocked_response(
    status: int | None,
    headers: dict[str, str] | None,
    html: str | bytes,
    hostname: str,
) -> dict:
    """Classify possible bot/WAF blocks with confidence tiers.

    High-confidence signals immediately mark blocked. Low-confidence signals are
    logged for observability but are not treated as blocked by themselves.
    Tuning options should primarily adjust keyword lists and the optional low-
    confidence retry flag.
    """
    normalized_headers = _normalize_headers(headers)
    provider = _detect_provider(normalized_headers)
    text = html.decode("utf-8", errors="ignore") if isinstance(html, bytes) else (html or "")
    haystack = text.lower()
    status_code = status or 0

    strong_markers = {
        "cf_challenge_path": "/cdn-cgi/",
        "cf_chl_marker": "cf-chl-",
        "cf_turnstile": "cf-turnstile",
        "cf_just_a_moment": "just a moment",
        "cf_checking_browser": "checking your browser before accessing",
        "cf_attention_required": "attention required",
        "challenge_platform": "challenge-platform",
    }
    weak_markers = {
        "generic_enable_js": "enable javascript",
        "generic_enable_cookies": "enable cookies",
        "generic_access_denied": "access denied",
        "generic_verify_human": "verify you are human",
        "generic_captcha": "captcha",
    }

    reasons: list[str] = []
    strong_hits = [reason for reason, marker in strong_markers.items() if marker in haystack]
    reasons.extend(strong_hits)

    waf_provider = provider in {"cloudflare", "akamai", "perimeterx"}
    if status_code in {401, 403, 429, 503} and waf_provider:
        reasons.append(f"status_{status_code}_{provider}")
        return {
            "is_blocked": True,
            "confidence": "high",
            "reasons": reasons,
            "provider": provider,
            "hostname": hostname,
        }

    if strong_hits:
        reasons.append("strong_challenge_marker")
        return {
            "is_blocked": True,
            "confidence": "high",
            "reasons": reasons,
            "provider": provider,
            "hostname": hostname,
        }

    weak_hits = [reason for reason, marker in weak_markers.items() if marker in haystack]
    if status_code == 200 and weak_hits:
        reasons.extend(weak_hits)
        reasons.append("keyword_only_low_conf")
        return {
            "is_blocked": False,
            "confidence": "low",
            "reasons": reasons,
            "provider": provider,
            "hostname": hostname,
        }

    return {
        "is_blocked": False,
        "confidence": "none",
        "reasons": reasons,
        "provider": provider,
        "hostname": hostname,
    }

def extract_ray_id(html_text: str) -> str | None:
    match = re.search(r"ray id[:\s#]*([a-f0-9]{8,})", html_text, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def _extract_ray_id_from_headers(headers: dict[str, str] | None) -> str | None:
    normalized_headers = _normalize_headers(headers)
    ray_id = normalized_headers.get("cf-ray")
    if not ray_id:
        return None
    return ray_id.strip() or None

def build_blocked_html(hostname: str, ray_id: str | None) -> str:
    ray_block = ""
    if ray_id:
        ray_block = f"<span><strong>Ray ID:</strong> {ray_id}</span>"
    return BLOCKED_PAGE_HTML.format(hostname=hostname or "Unknown", ray_id_block=ray_block)

# --- Main Fetch and Clean Function ---
async def fetch_and_clean_page(
    url: str,
    user_ip: str,
    http_session: httpx.AsyncClient,
    redis_get: callable,
    redis_set: callable,
    unlock: bool = True,
    use_cloudscraper: bool = False,
    fetch_limiter: PriorityLimiter | None = None,
    queue_priority: int = 2,
    redis_incr: callable = None,     
    redis_expire: callable = None  
) -> str:
    logger.info("Processing URL: %s", url)
    metrics.inc("unlock_pipeline.request_count")

    if urlparse(url).scheme not in ('http', 'https'):
        logger.warning("Rejected URL due to invalid scheme: %s", url)
        return "<div style='color:red;'>Invalid URL.</div>"

    ssrf_started_at = perf_counter()
    ssrf_risk = await is_ssrf_risk(url)
    _record_stage_timing("ssrf_check", ssrf_started_at, {"risk": ssrf_risk})
    if ssrf_risk:
        logger.warning("Blocked URL due to SSRF risk: %s (IP: %s)", url, user_ip)
        return "<div style='color:red;'>Access denied due to SSRF risk.</div>"

    cache_key = f"html:{hash_url_key(url, unlock)}"

    cache_get_started_at = perf_counter()
    cached = await redis_get(cache_key)
    _record_stage_timing("cache_get", cache_get_started_at, {"cache_hit": bool(cached)})
    try:
        if isinstance(cached, dict) and "result" in cached:
            metrics.inc("unlock_pipeline.cache_hit_count")
            return cached["result"]
        if isinstance(cached, str):
            metrics.inc("unlock_pipeline.cache_hit_count")
            return cached

    except Exception as e:
        logger.error("Failed to decode cached content: %s", e)
        return "<div style='color:red;'>Cache decoding error.</div>"

    referer = build_referer(url)
    headers = build_browser_headers(
        user_agent=random.choice(USER_AGENTS),
        referer=referer,
    )
    hostname = urlparse(url).hostname or ""

    async def _fetch_with_cloudscraper() -> tuple[str, int, dict, str]:
        def _fetch() -> tuple[str, int, dict, str]:
            hostname = urlparse(url).hostname or ""
            scraper, session_headers = _cloudscraper_session_pool.get_session(hostname)
            session_user_agent = session_headers.get("User-Agent")
            request_headers = build_browser_headers(user_agent=session_user_agent, referer=referer)
            merged_headers = {**session_headers, **request_headers}
            if "User-Agent" in session_headers:
                merged_headers["User-Agent"] = session_headers["User-Agent"]
            response = record_dependency_call(
                "cloudscraper",
                lambda: scraper.get(url, headers=merged_headers, timeout=FETCH_TIMEOUT_SECONDS),
            )
            logger.info(
                "[cloudscraper] Response for hostname=%s status=%s headers=%s",
                hostname,
                response.status_code,
                dict(response.headers),
            )
            final_url = response.url if isinstance(response.url, str) else str(response.url)
            response_headers = dict(response.headers)
            response_text = _decode_response_body(
                response.content,
                response_headers,
                response.encoding,
            )
            return response_text, response.status_code, response_headers, final_url

        return await asyncio.to_thread(_fetch)

    async def _fetch_with_httpx() -> httpx.Response:
        timeout = httpx.Timeout(
            FETCH_TIMEOUT_SECONDS,
            connect=FETCH_CONNECT_TIMEOUT_SECONDS,
        )
        response = await record_dependency_call_async(
            "http_fetch",
            lambda: http_session.get(url, headers=headers, timeout=timeout),
        )
        response.raise_for_status()
        return response

    async def _fetch_with_retries():
        retry_ceiling = _effective_retry_ceiling()
        logger.info("unlock_retry_ceiling selected=%s configured=%s", retry_ceiling, FETCH_MAX_RETRIES)
        for attempt in range(1, retry_ceiling + 1):
            if attempt > 1:
                metrics.inc("unlock_pipeline.retry_count")
            try:
                if use_cloudscraper:
                    logger.info("[cloudscraper] Fetching with Cloudscraper...")
                    fetched_text, status_code, response_headers, final_url = await _fetch_with_cloudscraper()
                    classification = classify_blocked_response(
                        status=status_code,
                        headers=response_headers,
                        html=fetched_text,
                        hostname=hostname,
                    )
                    ray_id = _extract_ray_id_from_headers(response_headers) or extract_ray_id(fetched_text)
                    blocked = classification["is_blocked"] and classification["confidence"] == "high"
                    if classification["confidence"] == "low":
                        logger.info(
                            "[cloudscraper] suspected_block_low_conf hostname=%s status=%s provider=%s confidence=%s reasons=%s ray_id=%s",
                            hostname,
                            status_code,
                            classification.get("provider"),
                            classification.get("confidence"),
                            classification.get("reasons"),
                            ray_id,
                        )
                        if LOW_CONF_BLOCK_RETRY_ENABLED and attempt < retry_ceiling:
                            await asyncio.sleep(0.75 * attempt + random.uniform(0, 0.35))
                            continue
                    if blocked and attempt < retry_ceiling:
                        logger.warning(
                            "[cloudscraper] blocked_response_detected hostname=%s status=%s provider=%s confidence=%s blocked_reason=%s ray_id=%s attempt=%s/%s",
                            hostname,
                            status_code,
                            classification.get("provider"),
                            classification.get("confidence"),
                            ",".join(classification.get("reasons") or ["unknown"]),
                            ray_id,
                            attempt,
                            retry_ceiling,
                        )
                        _cloudscraper_session_pool.evict(hostname)
                        await asyncio.sleep(0.75 * attempt + random.uniform(0, 0.35))
                        continue
                    content_type = response_headers.get("Content-Type", "")
                    content_length = int(
                        response_headers.get("Content-Length")
                        or len(fetched_text.encode("utf-8", "replace"))
                    )
                    fetch_meta = {
                        "method": "cloudscraper",
                        "status_code": status_code,
                        "final_url": final_url,
                        "server": response_headers.get("Server"),
                        "attempts": attempt,
                    }
                    return fetched_text, content_type, content_length, fetch_meta, response_headers

                logger.info("[httpx] Fetching with standard HTTP client...")
                response = await _fetch_with_httpx()
                content_type = response.headers.get("Content-Type", "")
                content_length = int(
                    response.headers.get("Content-Length") or len(response.content)
                )
                response_headers = dict(response.headers)
                response_text = _decode_response_body(
                    response.content,
                    response_headers,
                    response.encoding,
                )
                fetch_meta = {
                    "method": "httpx",
                    "status_code": response.status_code,
                    "final_url": str(response.url),
                    "server": response.headers.get("Server"),
                    "attempts": attempt,
                }
                return response_text, content_type, content_length, fetch_meta, response_headers
            except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.TransportError) as e:
                logger.warning(
                    "Fetch attempt %s failed for %s: %s", attempt, url, e
                )
                if attempt >= retry_ceiling:
                    raise
                await asyncio.sleep(0.25 * attempt + random.uniform(0.0, 0.3))
            except requests.RequestException as e:
                logger.warning(
                    "Fetch attempt %s failed for %s: %s", attempt, url, e
                )
                if attempt >= retry_ceiling:
                    raise
                await asyncio.sleep(0.25 * attempt + random.uniform(0.0, 0.3))
            except Exception as e:
                logger.warning("Fetch attempt %s failed for %s: %s", attempt, url, e)
                if attempt >= retry_ceiling:
                    raise
                await asyncio.sleep(0.25 * attempt + random.uniform(0.0, 0.3))


    try:
        fetch_started_at = perf_counter()
        if fetch_limiter:
            async with fetch_limiter.limit(queue_priority) as queue_wait_ms:
                metrics.observe_ms("unlock_pipeline.queue_wait", queue_wait_ms)
                response_text, content_type, content_length, fetch_meta, response_headers = await _fetch_with_retries()
        else:
            metrics.observe_ms("unlock_pipeline.queue_wait", 0.0)
            response_text, content_type, content_length, fetch_meta, response_headers = await _fetch_with_retries()
        fetch_duration_ms = _record_stage_timing("fetch", fetch_started_at, {"method": fetch_meta.get("method")})
    except Exception as e:
        logger.error("Failed to fetch URL %s: %s", url, e)
        return f"<div style='color:red;'>Fetch error: {e}</div>"

    logger.info(
        "Fetch result hostname=%s method=%s status=%s content_length=%s attempts=%s",
        hostname,
        fetch_meta.get("method"),
        fetch_meta.get("status_code"),
        content_length,
        fetch_meta.get("attempts"),
    )
    logger.info("Content-Type: %s", content_type)
    logger.info("Content-Length: %d bytes", content_length)

    if content_length > MAX_PROCESSABLE_PAGE_BYTES:
        logger.warning("Page too large: %s content_length=%s limit=%s", url, content_length, MAX_PROCESSABLE_PAGE_BYTES)
        metrics.inc("unlock_pipeline.page_too_large_count")
        return "<div style='color:red;'>This page is too large to unlock safely right now. Try the original site or narrow to a lighter page.</div>"

    if fetch_duration_ms > SLOW_FETCH_THRESHOLD_MS:
        logger.warning("Fetch exceeded slow threshold url=%s fetch_ms=%.2f threshold_ms=%.2f", url, fetch_duration_ms, SLOW_FETCH_THRESHOLD_MS)
        metrics.inc("unlock_pipeline.slow_fetch_count")

    if not isinstance(response_text, str) or not response_text.strip():
        logger.error("Fetched HTML is not valid or empty.")
        return "<div style='color:red;'>Invalid HTML content.</div>"

    logger.info("Fetched HTML: type=%s, length=%d", type(response_text), len(response_text))
    base_url = url
    classification = classify_blocked_response(
        status=fetch_meta.get("status_code"),
        headers=response_headers,
        html=response_text,
        hostname=hostname,
    )
    ray_id = _extract_ray_id_from_headers(response_headers) or extract_ray_id(response_text)
    if classification["confidence"] == "low":
        logger.info(
            "suspected_block_low_conf hostname=%s status=%s provider=%s confidence=%s reasons=%s ray_id=%s",
            hostname,
            fetch_meta.get("status_code"),
            classification.get("provider"),
            classification.get("confidence"),
            classification.get("reasons"),
            ray_id,
        )

    if classification["is_blocked"] and classification["confidence"] == "high":
        metrics.inc("unlock_pipeline.blocked_count")
        logger.warning(
            "blocked_response_detected hostname=%s status=%s provider=%s confidence=%s blocked_reason=%s ray_id=%s",
            hostname,
            fetch_meta.get("status_code"),
            classification.get("provider"),
            classification.get("confidence"),
            ",".join(classification.get("reasons") or ["unknown"]),
            ray_id,
        )
        if fetch_meta.get("method") == "cloudscraper":
            _cloudscraper_session_pool.evict(hostname)
        if fetch_meta.get("method") == "httpx" and not use_cloudscraper:
            cache_set_started_at = perf_counter()
            await redis_set(
                cache_key,
                {"result": UPGRADE_REQUIRED_HTML},
                ttl_seconds=BLOCKED_PAGE_TTL_SECONDS,
            )
            _record_stage_timing("cache_set", cache_set_started_at, {"ttl": BLOCKED_PAGE_TTL_SECONDS, "reason": "upgrade_required"})
            return UPGRADE_REQUIRED_HTML
        blocked_html = build_blocked_html(hostname, ray_id)
        cached_blocked_html = build_blocked_html(hostname, None)
        cache_set_started_at = perf_counter()
        await redis_set(
            cache_key,
            {"result": cached_blocked_html},
            ttl_seconds=BLOCKED_PAGE_TTL_SECONDS,
        )
        _record_stage_timing("cache_set", cache_set_started_at, {"ttl": BLOCKED_PAGE_TTL_SECONDS, "reason": "blocked"})
        return blocked_html

    if not unlock:
        safe_html = sanitize_html(response_text, base_url)
        try:
            safe_html = (
                safe_html
                .encode("utf-8", errors="replace")
                .decode("utf-8", errors="replace")
            )
        except Exception as e:
            logger.error("UTF-8 normalization failed: %s", e)
            return "<div style='color:red;'>Encoding error.</div>"

        cache_set_started_at = perf_counter()
        await redis_set(cache_key, {"result": safe_html}, ttl_seconds=CACHE_TTL_SECONDS)
        _record_stage_timing("cache_set", cache_set_started_at, {"ttl": CACHE_TTL_SECONDS, "mode": "sanitize"})
        await _maybe_autotune_fetch_controls(fetch_limiter)
        return safe_html

    response_text = response_text.encode('utf-8', 'replace').decode('utf-8', 'replace')
    response_text = response_text.replace('\x00', '')

    def clean_known_blockers(raw_html: str) -> str:
        patterns = [
            r'document\.(oncopy|oncut|oncontextmenu|onselectstart)\s*=\s*function\s*\([^)]*\)\s*{[^}]+}',
            r'window\.(oncopy|oncut|oncontextmenu|onselectstart)\s*=\s*function\s*\([^)]*\)\s*{[^}]+}',
            r'on(copy|cut|contextmenu|selectstart|mousedown)="[^"]+"'
        ]
        for pattern in patterns:
            raw_html = re.sub(pattern, '', raw_html, flags=re.IGNORECASE)
        return raw_html

    response_text = clean_known_blockers(response_text)

    parse_started_at = perf_counter()
    if len(response_text.encode("utf-8", "replace")) > MAX_PARSE_PAGE_BYTES:
        logger.warning("Skipping deep parse due to large body url=%s parse_bytes_limit=%s", url, MAX_PARSE_PAGE_BYTES)
        metrics.inc("unlock_pipeline.parse_skipped_large_body_count")
        return "<div style='color:red;'>This page is heavy and timed out during safe rewrite. Please open it directly and retry with a narrower page.</div>"

    try:
        tree = HTMLParser(response_text)
        num_rebased, num_skipped_invalid_url = rebase_html_resources_selectolax(tree, base_url)
        patch_lazy_loaded_images_selectolax(tree)
        num_integrity_stripped = strip_integrity_attributes(tree)
        font_counts = apply_font_simplification(tree)
        logger.info(
            "Font cleanup: removed_font_links=%s removed_font_preloads=%s "
            "stripped_font_face_blocks=%s removed_google_font_links=%s",
            font_counts["removed_font_links"],
            font_counts["removed_font_preloads"],
            font_counts["stripped_font_face_blocks"],
            font_counts["removed_google_font_links"],
        )
        logger.info(
            "Resource cleanup: num_rebased=%s num_skipped_invalid_url=%s num_integrity_stripped=%s",
            num_rebased,
            num_skipped_invalid_url,
            num_integrity_stripped,
        )
    except Exception as e:
        logger.warning("Selectolax parsing/rebase failed: %s", e)
        try:
            soup = BeautifulSoup(response_text, "html.parser")
            num_rebased, num_skipped_invalid_url = rebase_html_resources(soup, base_url)
            patch_lazy_loaded_images(soup)
            response_text = str(soup)
            tree = HTMLParser(response_text)
            num_integrity_stripped = strip_integrity_attributes(tree)
            font_counts = apply_font_simplification(tree)
            logger.info(
                "Font cleanup: removed_font_links=%s removed_font_preloads=%s "
                "stripped_font_face_blocks=%s removed_google_font_links=%s",
                font_counts["removed_font_links"],
                font_counts["removed_font_preloads"],
                font_counts["stripped_font_face_blocks"],
                font_counts["removed_google_font_links"],
            )
            logger.info(
                "Resource cleanup: num_rebased=%s num_skipped_invalid_url=%s num_integrity_stripped=%s",
                num_rebased,
                num_skipped_invalid_url,
                num_integrity_stripped,
            )
        except Exception as fallback_error:
            logger.error("HTML parsing failed: %s", fallback_error)
            return "<div style='color:red;'>This page could not be safely rewritten. Please open the original page and retry.</div>"

    num_scripts_removed = apply_dom_cleanups(tree)
    logger.info("Script cleanup: num_scripts_removed=%s", num_scripts_removed)

    try:
        html = tree.html
        doctype = extract_doctype(response_text)
        if doctype and not html.lower().lstrip().startswith("<!doctype"):
            html = f"{doctype}\n{html}"
        if should_fallback_selectolax(response_text, html):
            soup = BeautifulSoup(response_text, "html.parser")
            num_rebased, num_skipped_invalid_url = rebase_html_resources(soup, base_url)
            patch_lazy_loaded_images(soup)
            fallback_html = str(soup)
            tree = HTMLParser(fallback_html)
            num_integrity_stripped = strip_integrity_attributes(tree)
            num_scripts_removed = apply_dom_cleanups(tree)
            html = tree.html
            logger.info(
                "Resource cleanup: num_rebased=%s num_skipped_invalid_url=%s num_integrity_stripped=%s",
                num_rebased,
                num_skipped_invalid_url,
                num_integrity_stripped,
            )
            logger.info("Script cleanup: num_scripts_removed=%s", num_scripts_removed)
            if doctype and not html.lower().lstrip().startswith("<!doctype"):
                html = f"{doctype}\n{html}"
        banner_code = BANNER_HTML
        script_code = f"<script>{CUSTOM_JS_SCRIPT}</script>"
        if "</body>" in html:
            updated_html = html.replace("</body>", banner_code + script_code + "</body>")
        else:
            updated_html = html + banner_code + script_code
    except Exception as e:
        logger.error("Error injecting banner and script: %s", e)
        updated_html = "<div style='color:red;'>Failed to inject enhancements.</div>"

    _record_stage_timing("parse_clean_rewrite", parse_started_at)

    try:
        cache_set_started_at = perf_counter()
        await redis_set(cache_key, {"result": updated_html}, ttl_seconds=CACHE_TTL_SECONDS)
        _record_stage_timing("cache_set", cache_set_started_at, {"ttl": CACHE_TTL_SECONDS})
        logger.info("Page processed and cached.")
        await _maybe_autotune_fetch_controls(fetch_limiter)
        return updated_html
    except Exception as e:
        logger.error("Final serialization error: %s", e)
        return "<div style='color:red;'>Failed to render page.</div>"
    
