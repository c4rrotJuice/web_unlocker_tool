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
import cloudscraper
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from selectolax.parser import HTMLParser

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

CACHE_TTL_SECONDS = 3600
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

# --- Fix relative resource URLs ---
def rebase_html_resources(soup: BeautifulSoup, base_url: str):
    for tag in soup.find_all("link", href=True):
        tag["href"] = urljoin(base_url, tag["href"])
    for tag in soup.find_all("script", src=True):
        tag["src"] = urljoin(base_url, tag["src"])
    for tag in soup.find_all("img", src=True):
        tag["src"] = urljoin(base_url, tag["src"])
    for tag in soup.find_all(["iframe", "audio", "video", "source"], src=True):
        tag["src"] = urljoin(base_url, tag["src"])
    for tag in soup.find_all("a", href=True):
        tag["href"] = urljoin(base_url, tag["href"])
    for tag in soup.find_all("form", action=True):
        tag["action"] = urljoin(base_url, tag["action"])
        
def patch_lazy_loaded_images(soup):
    for img in soup.find_all("img"):
        if img.has_attr("data-src") and not img.has_attr("src"):
            img["src"] = img["data-src"]
        elif img.has_attr("data-lazy-src") and not img.has_attr("src"):
            img["src"] = img["data-lazy-src"]
        elif img.has_attr("data-original") and not img.has_attr("src"):
            img["src"] = img["data-original"]

def rebase_html_resources_selectolax(tree: HTMLParser, base_url: str) -> None:
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
                node.attributes[attr] = urljoin(base_url, value)

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

    headers = {
    "User-Agent": random.choice(USER_AGENTS),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
}


    async def _fetch_with_cloudscraper() -> str:
        def _fetch() -> str:
            scraper = cloudscraper.create_scraper()
            return scraper.get(url, headers=headers, timeout=FETCH_TIMEOUT_SECONDS).text

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
                    fetched_text = await _fetch_with_cloudscraper()
                    return fetched_text, "text/html", len(fetched_text.encode("utf-8", "replace"))

                logger.info("[httpx] Fetching with standard HTTP client...")
                response = await _fetch_with_httpx()
                content_type = response.headers.get("Content-Type", "")
                content_length = int(
                    response.headers.get("Content-Length") or len(response.content)
                )
                response_text = response.content.decode(
                    response.encoding or "utf-8", errors="replace"
                )
                return response_text, content_type, content_length
            except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.TransportError) as e:
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
                response_text, content_type, content_length = await _fetch_with_retries()
        else:
            response_text, content_type, content_length = await _fetch_with_retries()
    except Exception as e:
        logger.error("Failed to fetch URL %s: %s", url, e)
        return f"<div style='color:red;'>Fetch error: {e}</div>"

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
        rebase_html_resources_selectolax(tree, base_url)
        patch_lazy_loaded_images_selectolax(tree)
    except Exception as e:
        logger.warning("Selectolax parsing/rebase failed: %s", e)
        try:
            soup = BeautifulSoup(response_text, "html.parser")
            rebase_html_resources(soup, base_url)
            patch_lazy_loaded_images(soup)
            response_text = str(soup)
            tree = HTMLParser(response_text)
        except Exception as fallback_error:
            logger.error("HTML parsing failed: %s", fallback_error)
            return "<div style='color:red;'>Error parsing HTML for unlock true.</div>"

    for script in tree.css('script'):
        try:
            src = script.attributes.get("src", "")
            if "gtag" in src or "analytics" in src or "json" in script.attributes.get("type", ""):
                continue
            if any(kw in (script.text() or "") for kw in [
                'oncopy', 'onselectstart', 'contextmenu', 'disableSelection', 'document.oncopy', 'document.oncontextmenu']):
                script.decompose()
        except Exception as e:
            logger.warning("Script removal error: %s", e)

    RESTRICTIVE_EVENTS = {"oncopy", "oncut", "oncontextmenu", "onselectstart", "onmousedown"}
    for el in tree.css('*'):
        try:
            for attr in list(el.attributes.keys()):
                if attr.lower() in RESTRICTIVE_EVENTS:
                    del el.attributes[attr]
        except Exception as e:
            logger.warning("Inline JS cleanup error: %s", e)

    try:
        html = tree.html
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
    
