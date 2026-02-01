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

import httpx
import bleach
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from selectolax.parser import HTMLParser

from app.services.cloudscraper_pool import SessionPool

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
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
      .container { max-width: 720px; margin: 64px auto; background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 8px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; font-size: 24px; }
      p { line-height: 1.6; margin: 12px 0; }
      .meta { margin-top: 20px; padding: 16px; background: #f1f5f9; border-radius: 8px; font-size: 14px; }
      .meta span { display: block; margin: 4px 0; }
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
]

def build_referer(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme and parsed.hostname:
        return f"{parsed.scheme}://{parsed.hostname}/"
    return None

def build_base_headers(user_agent: str | None = None, referer: str | None = None) -> dict:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
    }
    if user_agent:
        headers["User-Agent"] = user_agent
    if referer:
        headers["Referer"] = referer
    return headers

def _cloudscraper_header_factory(hostname: str) -> dict:
    user_agent = random.choice(USER_AGENTS)
    return build_base_headers(user_agent=user_agent)

_cloudscraper_session_pool = SessionPool(max_size=32, header_factory=_cloudscraper_header_factory)

CACHE_TTL_SECONDS = 3600
BLOCKED_PAGE_TTL_SECONDS = 600
FETCH_MAX_RETRIES = int(os.getenv("FETCH_MAX_RETRIES", "2"))
FETCH_TIMEOUT_SECONDS = float(os.getenv("FETCH_TIMEOUT_SECONDS", "15"))
FETCH_CONNECT_TIMEOUT_SECONDS = float(os.getenv("FETCH_CONNECT_TIMEOUT_SECONDS", "5"))

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

def detect_block_page(html_text: str, headers: dict | None, status_code: int | None) -> tuple[bool, str | None]:
    if not html_text:
        return False, None
    haystack = html_text.lower()
    indicators = [
        "cloudflare ray id",
        "sorry, you have been blocked",
        "please enable cookies",
    ]
    if any(indicator in haystack for indicator in indicators):
        return True, extract_ray_id(html_text)

    headers = headers or {}
    server_header = str(headers.get("server", headers.get("Server", ""))).lower()
    status_code = status_code or 0
    if "cloudflare" in server_header and status_code in {403, 429, 503}:
        return True, extract_ray_id(html_text)

    return False, None

def extract_ray_id(html_text: str) -> str | None:
    match = re.search(r"ray id[:\s#]*([a-f0-9]{8,})", html_text, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    return None

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
    fetch_semaphore: asyncio.Semaphore | None = None,
    redis_incr: callable = None,     
    redis_expire: callable = None  
) -> str:
    logger.info("Processing URL: %s", url)

    if urlparse(url).scheme not in ('http', 'https'):
        logger.warning("Rejected URL due to invalid scheme: %s", url)
        return "<div style='color:red;'>Invalid URL.</div>"

    if await is_ssrf_risk(url):
        logger.warning("Blocked URL due to SSRF risk: %s (IP: %s)", url, user_ip)
        return "<div style='color:red;'>Access denied due to SSRF risk.</div>"

    cache_key = f"html:{hash_url_key(url, unlock)}"
    
    cached = await redis_get(cache_key)
    try:
        if isinstance(cached, dict) and "result" in cached:
            return cached["result"]
        if isinstance(cached, str):
            return cached

    except Exception as e:
        logger.error("Failed to decode cached content: %s", e)
        return "<div style='color:red;'>Cache decoding error.</div>"

    referer = build_referer(url)
    headers = build_base_headers(
        user_agent=random.choice(USER_AGENTS),
        referer=referer,
    )
    
    async def _fetch_with_cloudscraper() -> tuple[str, int, dict, str]:
        def _fetch() -> tuple[str, int, dict, str]:
            hostname = urlparse(url).hostname or ""
            scraper, session_headers = _cloudscraper_session_pool.get_session(hostname)
            request_headers = build_base_headers(referer=referer)
            merged_headers = {**session_headers, **request_headers}
            if "User-Agent" in session_headers:
                merged_headers["User-Agent"] = session_headers["User-Agent"]
            response = scraper.get(url, headers=merged_headers, timeout=FETCH_TIMEOUT_SECONDS)
            logger.info(
                "[cloudscraper] Response for hostname=%s status=%s headers=%s",
                hostname,
                response.status_code,
                dict(response.headers),
            )
            final_url = response.url if isinstance(response.url, str) else str(response.url)
            return response.text, response.status_code, dict(response.headers), final_url

        return await asyncio.to_thread(_fetch)

    async def _fetch_with_httpx() -> httpx.Response:
        timeout = httpx.Timeout(
            FETCH_TIMEOUT_SECONDS,
            connect=FETCH_CONNECT_TIMEOUT_SECONDS,
        )
        response = await http_session.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        return response

    async def _fetch_with_retries():
        for attempt in range(1, FETCH_MAX_RETRIES + 1):
            try:
                if use_cloudscraper:
                    logger.info("[cloudscraper] Fetching with Cloudscraper...")
                    fetched_text, status_code, response_headers, final_url = await _fetch_with_cloudscraper()
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
                response_text = response.content.decode(
                    response.encoding or "utf-8", errors="replace"
                )
                response_headers = dict(response.headers)
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
                if attempt >= FETCH_MAX_RETRIES:
                    raise
                await asyncio.sleep(0.5 * attempt)
            except requests.RequestException as e:
                logger.warning(
                    "Fetch attempt %s failed for %s: %s", attempt, url, e
                )
                if attempt >= FETCH_MAX_RETRIES:
                    raise
                await asyncio.sleep(0.5 * attempt)
            except Exception as e:
                logger.warning("Fetch attempt %s failed for %s: %s", attempt, url, e)
                if attempt >= FETCH_MAX_RETRIES:
                    raise
                await asyncio.sleep(0.5 * attempt)


    try:
        if fetch_semaphore:
            async with fetch_semaphore:
                response_text, content_type, content_length, fetch_meta, response_headers = await _fetch_with_retries()
        else:
            response_text, content_type, content_length, fetch_meta, response_headers = await _fetch_with_retries()
    except Exception as e:
        logger.error("Failed to fetch URL %s: %s", url, e)
        return f"<div style='color:red;'>Fetch error: {e}</div>"

    hostname = urlparse(url).hostname or ""
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

    if content_length > 10_000_000:
        logger.warning("Page too large: %s", url)
        return "<div style='color:red;'>Page too large to process.</div>"

    if not isinstance(response_text, str) or not response_text.strip():
        logger.error("Fetched HTML is not valid or empty.")
        return "<div style='color:red;'>Invalid HTML content.</div>"

    logger.info("Fetched HTML: type=%s, length=%d", type(response_text), len(response_text))
    base_url = url
    is_blocked, ray_id = detect_block_page(
        response_text,
        response_headers,
        fetch_meta.get("status_code"),
    )
    if is_blocked:
        blocked_html = build_blocked_html(hostname, ray_id)
        cached_blocked_html = build_blocked_html(hostname, None)
        await redis_set(
            cache_key,
            {"result": cached_blocked_html},
            ttl_seconds=BLOCKED_PAGE_TTL_SECONDS,
        )
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

        await redis_set(cache_key, {"result": safe_html}, ttl_seconds=CACHE_TTL_SECONDS)
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
            return "<div style='color:red;'>Error parsing HTML for unlock true.</div>"

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

    try:
        await redis_set(cache_key, {"result": updated_html}, ttl_seconds=CACHE_TTL_SECONDS)
        logger.info("Page processed and cached.")
        return updated_html
    except Exception as e:
        logger.error("Final serialization error: %s", e)
        return "<div style='color:red;'>Failed to render page.</div>"
    
