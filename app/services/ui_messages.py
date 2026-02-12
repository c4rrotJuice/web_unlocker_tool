from __future__ import annotations

from dataclasses import dataclass

ERROR_COPY = {
    "INVALID_URL": "Please enter a valid URL.",
    "HUMAN_VERIFICATION_REQUIRED": "This page requires human verification before we can unlock it.",
    "DAILY_LIMIT_REACHED": "You've reached your daily unlock limit.",
    "WEEKLY_LIMIT_REACHED": "You've reached your weekly unlock limit.",
    "FETCH_TIMEOUT": "The request took too long. Please try again.",
    "UPSTREAM_BLOCKED": "The source blocked this request.",
    "AUTH_REQUIRED": "Please sign in to continue.",
    "TOKEN_EXPIRED": "Your session expired. Please sign in again.",
    "RATE_LIMITED": "Too many requests. Please wait and retry.",
    "SERVER_ERROR": "Something went wrong on our side.",
}

UNLOCK_STAGE_ORDER = ["UNLOCK_STARTED", "FETCHING_CONTENT", "CLEANING_CONTENT", "COMPLETE"]


@dataclass(frozen=True)
class MappedToast:
    type: str
    message: str
    redirect_to: str | None = None


def map_error_payload(payload: dict | None) -> MappedToast:
    payload = payload or {}
    nested = payload.get("error") or {}
    code = nested.get("code") or payload.get("error_code") or "SERVER_ERROR"
    message = ERROR_COPY.get(code) or nested.get("message") or payload.get("message") or ERROR_COPY["SERVER_ERROR"]

    redirect_to = None
    if code in {"AUTH_REQUIRED", "TOKEN_EXPIRED"}:
        redirect_to = "/auth"

    toast_type = "warning" if code == "RATE_LIMITED" else "error"
    return MappedToast(type=toast_type, message=message, redirect_to=redirect_to)


def is_valid_unlock_transition(previous: str | None, nxt: str) -> bool:
    if nxt not in UNLOCK_STAGE_ORDER:
        return False
    if previous is None:
        return nxt == "UNLOCK_STARTED"

    try:
        prev_index = UNLOCK_STAGE_ORDER.index(previous)
        next_index = UNLOCK_STAGE_ORDER.index(nxt)
    except ValueError:
        return False

    return next_index >= prev_index and next_index - prev_index <= 1
