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
from dataclasses import dataclass
from typing import Literal
import brotli
import httpx
import bleach
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from selectolax.parser import HTMLParser
from app.services.cloudscraper_pool import SessionPool
from app.services.priority_limiter import PriorityLimiter
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
      <button type="button" disabled style="margin-top: 16px; padding: 10px 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #e2e8f0; color: #475569;">
        use extention for guaranteed unlock
      </button>
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
@dataclass
class FetchOutcome:
    success: bool
    html: str
    http_status: int | None
    attempts: int
    outcome_reason: Literal[
        "ok",
        "blocked_by_cloudflare",
        "blocked_by_waf",
        "suspected_block_low_conf",
        "fetch_error",
    ]
    provider: str | None
    confidence: Literal["high", "low", "none"]
    reasons: list[str]
    ray_id: str | None
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
def _looks_like_brotli_stream(body: bytes) -> bool:
    if not body:
        return False
    sample = body[:64]
    return any(byte == 0 for byte in sample)
def _decode_response_body(
    body: bytes,
    headers: dict,
    encoding_hint: str | None,
    *,
    request_decoded: bool = True,
    hostname: str | None = None,
    status: int | None = None,
) -> str:
    content_encoding = str(headers.get("Content-Encoding", "")).lower()
    decoded_body = body
    should_try_manual_brotli = "br" in content_encoding
    if should_try_manual_brotli:
        try:
            decoded_body = brotli.decompress(body)
        except Exception as e:
            logger.debug(
                "Skipping manual brotli decode hostname=%s status=%s error=%s",
                hostname,
                status,
                e,
            )
            decoded_body = body
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
    redis_expire: callable = None,
) -> FetchOutcome:
    logger.info("Processing URL: %s", url)
    def _outcome(
        *,
        success: bool,
        html: str,
        http_status: int | None,
        attempts: int,
        outcome_reason: str,
        provider: str | None = None,
        confidence: str = "none",
        reasons: list[str] | None = None,
        ray_id: str | None = None,
    ) -> FetchOutcome:
        return FetchOutcome(
            success=success,
            html=html,
            http_status=http_status,
            attempts=attempts,
            outcome_reason=outcome_reason,
            provider=provider,
            confidence=confidence,
            reasons=reasons or [],
            ray_id=ray_id,
        )
    if urlparse(url).scheme not in ("http", "https"):
        logger.warning("Rejected URL due to invalid scheme: %s", url)
        return _outcome(
            success=False,
            html="<div style='color:red;'>Invalid URL.</div>",
            http_status=None,
            attempts=0,
            outcome_reason="fetch_error",
        )
    if await is_ssrf_risk(url):
        logger.warning("Blocked URL due to SSRF risk: %s (IP: %s)", url, user_ip)
        return _outcome(
            success=False,
            html="<div style='color:red;'>Access denied due to SSRF risk.</div>",
            http_status=None,
            attempts=0,
            outcome_reason="fetch_error",
        )
    cache_key = f"html:{hash_url_key(url, unlock)}"
    cached = await redis_get(cache_key)
    try:
        if isinstance(cached, dict) and "result" in cached:
            return _outcome(success=True, html=cached["result"], http_status=200, attempts=0, outcome_reason="ok")
        if isinstance(cached, str):
            return _outcome(success=True, html=cached, http_status=200, attempts=0, outcome_reason="ok")
    except Exception as e:
        logger.error("Failed to decode cached content: %s", e)
        return _outcome(
            success=False,
            html="<div style='color:red;'>Cache decoding error.</div>",
            http_status=None,
            attempts=0,
            outcome_reason="fetch_error",
        )
    referer = build_referer(url)
    headers = build_browser_headers(user_agent=random.choice(USER_AGENTS), referer=referer)
    hostname = urlparse(url).hostname or ""
    async def _fetch_with_cloudscraper() -> tuple[str, int, dict, str]:
        def _fetch() -> tuple[str, int, dict, str]:
            scraper, session_headers = _cloudscraper_session_pool.get_session(hostname)
            session_user_agent = session_headers.get("User-Agent")
            request_headers = build_browser_headers(user_agent=session_user_agent, referer=referer)
            merged_headers = {**session_headers, **request_headers}
            if "User-Agent" in session_headers:
                merged_headers["User-Agent"] = session_headers["User-Agent"]
            response = scraper.get(url, headers=merged_headers, timeout=FETCH_TIMEOUT_SECONDS)
            response_headers = dict(response.headers)
            response_text = _decode_response_body(
                response.content,
                response_headers,
                response.encoding,
                request_decoded=True,
                hostname=hostname,
                status=response.status_code,
            )
            final_url = response.url if isinstance(response.url, str) else str(response.url)
            return response_text, response.status_code, response_headers, final_url
        return await asyncio.to_thread(_fetch)
    async def _fetch_with_httpx() -> httpx.Response:
        timeout = httpx.Timeout(FETCH_TIMEOUT_SECONDS, connect=FETCH_CONNECT_TIMEOUT_SECONDS)
        response = await http_session.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        return response
    async def _fetch_with_retries() -> tuple[str, int, dict, int, str, str]:
        for attempt in range(1, FETCH_MAX_RETRIES + 1):
            try:
                if use_cloudscraper:
                    fetched_text, status_code, response_headers, final_url = await _fetch_with_cloudscraper()
                    classification = classify_blocked_response(status=status_code, headers=response_headers, html=fetched_text, hostname=hostname)
                    ray_id = _extract_ray_id_from_headers(response_headers) or extract_ray_id(fetched_text)
                    blocked = classification["is_blocked"] and classification["confidence"] == "high"
                    if classification["confidence"] == "low" and LOW_CONF_BLOCK_RETRY_ENABLED and attempt < FETCH_MAX_RETRIES:
                        await asyncio.sleep(0.75 * attempt + random.uniform(0, 0.35))
                        continue
                    if blocked and attempt < FETCH_MAX_RETRIES:
                        _cloudscraper_session_pool.evict(hostname)
                        await asyncio.sleep(0.75 * attempt + random.uniform(0, 0.35))
                        continue
                    return fetched_text, status_code, response_headers, attempt, "cloudscraper", final_url
                response = await _fetch_with_httpx()
                response_headers = dict(response.headers)
                response_text = _decode_response_body(
                    response.content,
                    response_headers,
                    response.encoding,
                    request_decoded=True,
                    hostname=hostname,
                    status=response.status_code,
                )
                return response_text, response.status_code, response_headers, attempt, "httpx", str(response.url)
            except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.TransportError, requests.RequestException) as e:
                logger.warning("Fetch attempt %s failed for %s: %s", attempt, url, e)
                if attempt >= FETCH_MAX_RETRIES:
                    raise
                await asyncio.sleep(0.5 * attempt)
            except Exception as e:
                logger.warning("Fetch attempt %s failed for %s: %s", attempt, url, e)
                if attempt >= FETCH_MAX_RETRIES:
                    raise
                await asyncio.sleep(0.5 * attempt)
        raise RuntimeError("retries exhausted")
    try:
        if fetch_limiter:
            async with fetch_limiter.limit(queue_priority):
                response_text, status_code, response_headers, attempts, fetch_method, _final_url = await _fetch_with_retries()
        else:
            response_text, status_code, response_headers, attempts, fetch_method, _final_url = await _fetch_with_retries()
    except Exception as e:
        logger.error("Failed to fetch URL %s: %s", url, e)
        return _outcome(
            success=False,
            html=f"<div style='color:red;'>Fetch error: {e}</div>",
            http_status=None,
            attempts=FETCH_MAX_RETRIES,
            outcome_reason="fetch_error",
        )
    content_type = response_headers.get("Content-Type", "")
    content_length = int(response_headers.get("Content-Length") or len(response_text.encode("utf-8", "replace")))
    classification = classify_blocked_response(status=status_code, headers=response_headers, html=response_text, hostname=hostname)
    ray_id = _extract_ray_id_from_headers(response_headers) or extract_ray_id(response_text)
    if classification["confidence"] == "low":
        logger.info(
            "suspected_block_low_conf hostname=%s status=%s provider=%s confidence=%s reasons=%s ray_id=%s",
            hostname,
            status_code,
            classification.get("provider"),
            classification.get("confidence"),
            classification.get("reasons"),
            ray_id,
        )
    if classification["is_blocked"] and classification["confidence"] == "high":
        provider = classification.get("provider")
        outcome_reason = "blocked_by_cloudflare" if provider == "cloudflare" or ray_id else "blocked_by_waf"
        if fetch_method == "cloudscraper":
            _cloudscraper_session_pool.evict(hostname)
        blocked_html = build_blocked_html(hostname, ray_id)
        cached_blocked_html = build_blocked_html(hostname, None)
        await redis_set(cache_key, {"result": cached_blocked_html}, ttl_seconds=BLOCKED_PAGE_TTL_SECONDS)
        logger.warning(
            "blocked_response_detected hostname=%s status=%s provider=%s confidence=%s blocked_reason=%s ray_id=%s",
            hostname,
            status_code,
            provider,
            classification.get("confidence"),
            ",".join(classification.get("reasons") or ["unknown"]),
            ray_id,
        )
        return _outcome(
            success=False,
            html=blocked_html,
            http_status=status_code,
            attempts=attempts,
            outcome_reason=outcome_reason,
            provider=provider,
            confidence=classification.get("confidence", "none"),
            reasons=classification.get("reasons") or [],
            ray_id=ray_id,
        )
    if content_length > 10_000_000:
        logger.warning("Page too large: %s", url)
        return _outcome(
            success=False,
            html="<div style='color:red;'>Page too large to process.</div>",
            http_status=status_code,
            attempts=attempts,
            outcome_reason="fetch_error",
            provider=classification.get("provider"),
            confidence=classification.get("confidence", "none"),
            reasons=classification.get("reasons") or [],
            ray_id=ray_id,
        )
    if not isinstance(response_text, str) or not response_text.strip():
        return _outcome(
            success=False,
            html="<div style='color:red;'>Invalid HTML content.</div>",
            http_status=status_code,
            attempts=attempts,
            outcome_reason="fetch_error",
            provider=classification.get("provider"),
            confidence=classification.get("confidence", "none"),
            reasons=classification.get("reasons") or [],
            ray_id=ray_id,
        )
    base_url = url
    outcome_reason = "suspected_block_low_conf" if classification["confidence"] == "low" else "ok"
    if not unlock:
        safe_html = sanitize_html(response_text, base_url)
        safe_html = safe_html.encode("utf-8", errors="replace").decode("utf-8", errors="replace")
        await redis_set(cache_key, {"result": safe_html}, ttl_seconds=CACHE_TTL_SECONDS)
        return _outcome(
            success=True,
            html=safe_html,
            http_status=status_code,
            attempts=attempts,
            outcome_reason=outcome_reason,
            provider=classification.get("provider"),
            confidence=classification.get("confidence", "none"),
            reasons=classification.get("reasons") or [],
            ray_id=ray_id,
        )
    response_text = response_text.encode("utf-8", "replace").decode("utf-8", "replace").replace("\x00", "")
    def clean_known_blockers(raw_html: str) -> str:
        patterns = [
            r'document\.(oncopy|oncut|oncontextmenu|onselectstart)\s*=\s*function\s*\([^)]*\)\s*{[^}]+}',
            r'window\.(oncopy|oncut|oncontextmenu|onselectstart)\s*=\s*function\s*\([^)]*\)\s*{[^}]+}',
            r'on(copy|cut|contextmenu|selectstart|mousedown)="[^"]+"',
        ]
        for pattern in patterns:
            raw_html = re.sub(pattern, "", raw_html, flags=re.IGNORECASE)
        return raw_html
    response_text = clean_known_blockers(response_text)
    try:
        tree = HTMLParser(response_text)
        rebase_html_resources_selectolax(tree, base_url)
        patch_lazy_loaded_images_selectolax(tree)
        strip_integrity_attributes(tree)
        apply_font_simplification(tree)
    except Exception:
        try:
            soup = BeautifulSoup(response_text, "html.parser")
            rebase_html_resources(soup, base_url)
            patch_lazy_loaded_images(soup)
            response_text = str(soup)
            tree = HTMLParser(response_text)
            strip_integrity_attributes(tree)
            apply_font_simplification(tree)
        except Exception:
            return _outcome(
                success=False,
                html="<div style='color:red;'>Error parsing HTML for unlock true.</div>",
                http_status=status_code,
                attempts=attempts,
                outcome_reason="fetch_error",
                provider=classification.get("provider"),
                confidence=classification.get("confidence", "none"),
                reasons=classification.get("reasons") or [],
                ray_id=ray_id,
            )
    apply_dom_cleanups(tree)
    try:
        html = tree.html
        doctype = extract_doctype(response_text)
        if doctype and not html.lower().lstrip().startswith("<!doctype"):
            html = f"{doctype}\n{html}"
        if should_fallback_selectolax(response_text, html):
            soup = BeautifulSoup(response_text, "html.parser")
            rebase_html_resources(soup, base_url)
            patch_lazy_loaded_images(soup)
            fallback_html = str(soup)
            tree = HTMLParser(fallback_html)
            strip_integrity_attributes(tree)
            apply_dom_cleanups(tree)
            html = tree.html
            if doctype and not html.lower().lstrip().startswith("<!doctype"):
                html = f"{doctype}\n{html}"
        script_code = f"<script>{CUSTOM_JS_SCRIPT}</script>"
        if "</body>" in html:
            updated_html = html.replace("</body>", BANNER_HTML + script_code + "</body>")
        else:
            updated_html = html + BANNER_HTML + script_code
    except Exception:
        updated_html = "<div style='color:red;'>Failed to inject enhancements.</div>"
    await redis_set(cache_key, {"result": updated_html}, ttl_seconds=CACHE_TTL_SECONDS)
    return _outcome(
        success=True,
        html=updated_html,
        http_status=status_code,
        attempts=attempts,
        outcome_reason=outcome_reason,
        provider=classification.get("provider"),
        confidence=classification.get("confidence", "none"),
        reasons=classification.get("reasons") or [],
        ray_id=ray_id,
    )
