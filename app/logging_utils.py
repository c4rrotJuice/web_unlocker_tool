import contextvars
import json
import logging
import os
import re
import sys
import time
from typing import Any

_request_context: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "request_context", default={}
)


SENSITIVE_KEY_PARTS = (
    "token",
    "secret",
    "authorization",
    "api_key",
    "apikey",
    "password",
    "cookie",
)

SENSITIVE_VALUE_PATTERNS = [
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._\-~+/]+=*"),
    re.compile(r"(?i)(token=)[^\s&]+"),
    re.compile(r"(?i)(secret=)[^\s&]+"),
]



def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in SENSITIVE_KEY_PARTS)



def redact_value(value: Any, *, key: str | None = None) -> Any:
    if key and _is_sensitive_key(key):
        return "[REDACTED]"

    if isinstance(value, dict):
        return {k: redact_value(v, key=k) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [redact_value(v) for v in value]

    if isinstance(value, str):
        redacted = value
        for pattern in SENSITIVE_VALUE_PATTERNS:
            redacted = pattern.sub(r"\1[REDACTED]", redacted)
        return redacted

    return value




class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        request_ctx = _request_context.get({})
        for key in ("request_id", "route", "status", "latency_ms", "user_id", "upstream"):
            if not hasattr(record, key) or getattr(record, key) is None:
                setattr(record, key, request_ctx.get(key))
        return True

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": int(time.time() * 1000),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_value(record.getMessage()),
        }

        request_ctx = _request_context.get({})
        payload["request_id"] = request_ctx.get("request_id")
        payload["route"] = request_ctx.get("route")
        payload["status"] = request_ctx.get("status")
        payload["latency_ms"] = request_ctx.get("latency_ms")
        payload["user_id"] = request_ctx.get("user_id")
        payload["upstream"] = request_ctx.get("upstream")

        for key, value in record.__dict__.items():
            if key in {
                "name",
                "msg",
                "args",
                "levelname",
                "levelno",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "taskName",
                "message",
            }:
                continue
            payload[key] = redact_value(value, key=key)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)



def configure_logging() -> None:
    root_logger = logging.getLogger()
    if getattr(root_logger, "_web_unlocker_structured", False):
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestContextFilter())

    root_logger.handlers = [handler]
    root_logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    root_logger._web_unlocker_structured = True  # type: ignore[attr-defined]



def set_request_context(**kwargs: Any) -> None:
    ctx = dict(_request_context.get({}))
    ctx.update(kwargs)
    _request_context.set(ctx)



def clear_request_context() -> None:
    _request_context.set({})
