from __future__ import annotations

from html import escape
import logging
from uuid import uuid4

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse

logger = logging.getLogger(__name__)


def _request_id(request: Request | None) -> str:
    if request is not None:
        existing = getattr(request.state, "request_id", None)
        if existing:
            return str(existing)
    return str(uuid4())


def safe_api_error_response(
    *,
    request: Request | None,
    error_code: str,
    message: str,
    status_code: int = 500,
    exc: Exception | None = None,
) -> JSONResponse:
    request_id = _request_id(request)
    if exc is not None:
        logger.exception("API error %s request_id=%s", error_code, request_id)

    payload = {
        "error_code": error_code,
        "message": message,
        "request_id": request_id,
    }
    return JSONResponse(content=payload, status_code=status_code)


def safe_html_error_response(
    *,
    request: Request | None,
    error_code: str,
    message: str,
    status_code: int = 500,
    exc: Exception | None = None,
) -> HTMLResponse:
    request_id = _request_id(request)
    if exc is not None:
        logger.exception("HTML error %s request_id=%s", error_code, request_id)

    safe_code = escape(error_code)
    safe_message = escape(message)
    safe_request_id = escape(request_id)
    content = (
        "<div><h3>Request failed</h3>"
        f"<p data-error-code=\"{safe_code}\">{safe_message}</p>"
        f"<p data-request-id=\"{safe_request_id}\">request_id: {safe_request_id}</p></div>"
    )
    return HTMLResponse(content=content, status_code=status_code)
