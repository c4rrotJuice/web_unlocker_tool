#dashboard.py
from fastapi import APIRouter, Request, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from datetime import date, datetime, timedelta, timezone
import httpx
from app.routes.http import http_client
from app.services.entitlements import normalize_account_type
from app.services.momentum import (
    calculate_streak,
    count_active_days_in_range,
    determine_new_milestones,
    MILESTONE_CONFIG,
)
from app.services.reporting import build_monthly_report_pdf
from app.services.IP_usage_limit import (
    MAX_DAILY_USES,
    MAX_WEEKLY_USES,
    get_today_gmt3,
    get_week_start_gmt3,
)
import os

from app.routes.error_responses import safe_api_error_response
from app.services.resilience import DEFAULT_TIMEOUT

templates = Jinja2Templates(directory="app/templates")
router = APIRouter()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


def _get_month_range(month: str | None) -> tuple[date, date, str]:
    if month:
        try:
            month_start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Invalid month format.") from exc
    else:
        month_start = datetime.now(timezone.utc).date().replace(day=1)

    if month_start.month == 12:
        month_end = date(month_start.year + 1, 1, 1)
    else:
        month_end = date(month_start.year, month_start.month + 1, 1)

    month_label = month_start.strftime("%B %Y")
    return month_start, month_end, month_label


async def _count_records(
    table: str,
    user_id: str,
    filters: list[tuple[str, str]] | None = None,
) -> int:
    params: list[tuple[str, str]] = [
        ("user_id", f"eq.{user_id}"),
        ("select", "id"),
    ]
    if filters:
        params.extend(filters)
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "count=exact",
        },
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Failed to count {table}.")
    content_range = res.headers.get("content-range", "0-0/0")
    return int(content_range.split("/")[-1])


async def _fetch_unlock_days(user_id: str) -> list[date]:
    res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/get_unlock_days",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json={"p_user_id": user_id},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load unlock days.")
    return [datetime.fromisoformat(item["day"]).date() for item in res.json()]


async def _fetch_milestones(user_id: str) -> list[dict]:
    res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/user_milestones",
        params={
            "user_id": f"eq.{user_id}",
            "select": "milestone_key,awarded_at",
        },
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )
    if res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load milestones.")
    return res.json()


def _milestone_title_map() -> dict[str, str]:
    return {milestone.key: milestone.title for milestone in MILESTONE_CONFIG}

@router.get("/api/me")
async def get_user_metadata(request: Request):
    """
    Dashboard bootstrap endpoint.
    Auth is already handled by middleware.
    """

    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        # ── Fetch user_meta (already partly cached in middleware, but we need extra fields)
        meta_res = await http_client.get(
            f"{SUPABASE_URL}/rest/v1/user_meta",
            params={
                "user_id": f"eq.{user_id}",
                "select": "name,account_type,daily_limit,requests_today"
            },
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
            },
            timeout=DEFAULT_TIMEOUT,
        )

        if meta_res.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to load user metadata")

        meta = meta_res.json()
        if not meta:
            raise HTTPException(status_code=404, detail="User metadata not found")

        meta = meta[0]

        # ── Fetch latest bookmarks (degraded-mode friendly)
        degraded_reasons: list[str] = []
        try:
            bookmarks_res = await http_client.get(
                f"{SUPABASE_URL}/rest/v1/bookmarks",
                params={
                    "user_id": f"eq.{user_id}",
                    "order": "created_at.desc",
                    "limit": 50
                },
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                },
                timeout=DEFAULT_TIMEOUT,
            )
            bookmarks = bookmarks_res.json() if bookmarks_res.status_code == 200 else []
            if bookmarks_res.status_code != 200:
                degraded_reasons.append("BOOKMARKS_UNAVAILABLE")
        except Exception:
            bookmarks = []
            degraded_reasons.append("BOOKMARKS_UNAVAILABLE")

        account_type = normalize_account_type(meta.get("account_type"))
        if account_type in {"standard", "pro"}:
            usage_key = f"user_usage_week:{user_id}:{get_week_start_gmt3()}"
            usage_limit = MAX_WEEKLY_USES
            usage_period = "week"
        else:
            usage_key = f"user_usage:{user_id}:{get_today_gmt3()}"
            usage_limit = meta.get("daily_limit") or MAX_DAILY_USES
            usage_period = "day"

        usage_count = int(await request.app.state.redis_get(usage_key) or 0)
        if usage_period == "day" and meta.get("requests_today") != usage_count:
            await http_client.patch(
                f"{SUPABASE_URL}/rest/v1/user_meta",
                params={"user_id": f"eq.{user_id}"},
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                },
                json={"requests_today": usage_count},
            )

        payload = {
            "user_id": user_id,
            "name": meta.get("name"),
            "account_type": account_type,
            "daily_limit": meta.get("daily_limit"),
            "requests_today": usage_count,
            "bookmarks": bookmarks,
            "usage_count": usage_count,
            "usage_limit": usage_limit,
            "usage_period": usage_period,
        }
        if degraded_reasons:
            payload["degraded"] = True
            payload["error_code"] = "DASHBOARD_PARTIAL_DATA"
            payload["degraded_reasons"] = degraded_reasons
            return JSONResponse(content=payload, status_code=206)
        return payload

    except HTTPException:
        raise
    except Exception as e:
        return safe_api_error_response(
            request=request,
            error_code="DASHBOARD_METADATA_FAILED",
            message="Internal server error",
            exc=e,
        )


@router.get("/api/dashboard/momentum")
async def get_momentum(request: Request):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    today = datetime.now(timezone.utc).date()
    month_start, month_end, _ = _get_month_range(None)

    try:
        unlock_days = await _fetch_unlock_days(user_id)
    except Exception:
        return JSONResponse(
            content={
                "current_streak_days": 0,
                "has_unlock_today": False,
                "articles_unlocked_mtd": 0,
                "articles_unlocked_all_time": 0,
                "active_days_mtd": 0,
                "milestone": None,
                "degraded": True,
                "error_code": "MOMENTUM_PARTIAL_DATA",
            },
            status_code=206,
        )

    current_streak_days, has_unlock_today = calculate_streak(unlock_days, today)
    active_days_mtd = count_active_days_in_range(unlock_days, month_start, month_end)

    articles_unlocked_mtd = await _count_records(
        "unlock_history",
        user_id,
        [
            ("unlocked_at", f"gte.{month_start.isoformat()}"),
            ("unlocked_at", f"lt.{month_end.isoformat()}"),
        ],
    )
    articles_unlocked_all_time = await _count_records("unlock_history", user_id)

    metrics = {
        "current_streak_days": current_streak_days,
        "has_unlock_today": has_unlock_today,
        "articles_unlocked_mtd": articles_unlocked_mtd,
        "articles_unlocked_all_time": articles_unlocked_all_time,
        "active_days_mtd": active_days_mtd,
    }

    existing = await _fetch_milestones(user_id)
    existing_keys = {item["milestone_key"] for item in existing}
    to_award = determine_new_milestones(metrics, existing_keys)
    newest_milestone = None

    for milestone in to_award:
        res = await http_client.post(
            f"{SUPABASE_URL}/rest/v1/user_milestones",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json={
                "user_id": user_id,
                "milestone_key": milestone["key"],
                "metadata": {"threshold": milestone["threshold"]},
            },
        )
        if res.status_code in (200, 201):
            row = res.json()[0]
            milestone_data = {
                "key": milestone["key"],
                "title": milestone["title"],
                "awarded_at": row.get("awarded_at"),
            }
            if (
                newest_milestone is None
                or milestone_data["awarded_at"] > newest_milestone["awarded_at"]
            ):
                newest_milestone = milestone_data
        elif res.status_code not in (409,):
            raise HTTPException(status_code=500, detail="Failed to award milestone.")

    return {
        **metrics,
        "milestone": newest_milestone,
    }


@router.get("/api/reports/monthly")
async def get_monthly_report(request: Request, month: str | None = None):
    user_id = request.state.user_id
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    account_type = normalize_account_type(request.state.account_type)
    if account_type not in {"standard", "pro"}:
        raise HTTPException(status_code=403, detail="Report access requires a paid plan.")

    month_start, month_end, month_label = _get_month_range(month)
    month_range = f"{month_label} ({month_start:%b %d} – {(month_end - timedelta(days=1)):%b %d})"
    unlock_days = await _fetch_unlock_days(user_id)
    today = datetime.now(timezone.utc).date()
    current_streak_days, _ = calculate_streak(unlock_days, today)
    active_days_mtd = count_active_days_in_range(unlock_days, month_start, month_end)

    articles_unlocked_mtd = await _count_records(
        "unlock_history",
        user_id,
        [
            ("unlocked_at", f"gte.{month_start.isoformat()}"),
            ("unlocked_at", f"lt.{month_end.isoformat()}"),
        ],
    )

    citations_month = await _count_records(
        "citations",
        user_id,
        [
            ("cited_at", f"gte.{month_start.isoformat()}"),
            ("cited_at", f"lt.{month_end.isoformat()}"),
        ],
    )

    domains_res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/get_monthly_domain_counts",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json={"p_user_id": user_id, "p_month": month_start.isoformat()},
    )
    if domains_res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load domain patterns.")
    top_domains = [
        (row["domain"], row["unlocks"]) for row in domains_res.json() if row.get("domain")
    ]

    citations_res = await http_client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/get_monthly_citation_breakdown",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json={"p_user_id": user_id, "p_month": month_start.isoformat()},
    )
    if citations_res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load citation breakdown.")
    citation_breakdown = [
        (row["format"], row["citations"]) for row in citations_res.json()
    ]

    milestones_res = await http_client.get(
        f"{SUPABASE_URL}/rest/v1/user_milestones",
        params={
            "user_id": f"eq.{user_id}",
            "awarded_at": f"gte.{month_start.isoformat()}",
            "awarded_at": f"lt.{month_end.isoformat()}",
            "select": "milestone_key,awarded_at",
            "order": "awarded_at.asc",
        },
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )
    if milestones_res.status_code != 200:
        raise HTTPException(status_code=500, detail="Failed to load monthly milestones.")

    milestone_titles = _milestone_title_map()
    milestones = [
        milestone_titles.get(item["milestone_key"], item["milestone_key"])
        for item in milestones_res.json()
    ]

    summary_bullets = [
        f"Unlocked {articles_unlocked_mtd} articles across {active_days_mtd} active days.",
        f"Current streak is {current_streak_days} days.",
        f"Generated {citations_month} citations in total.",
    ]
    if top_domains:
        summary_bullets.append(f"Top domain: {top_domains[0][0]}.")
    if milestones:
        summary_bullets.append(f"Earned {len(milestones)} milestones this month.")

    report_payload = {
        "user_name": request.state.name or "Researcher",
        "month_range": month_range,
        "summary_bullets": summary_bullets[:6],
        "overview": {
            "articles_unlocked_mtd": articles_unlocked_mtd,
            "active_days_mtd": active_days_mtd,
            "current_streak_days": current_streak_days,
            "citations_month": citations_month,
        },
        "top_domains": top_domains,
        "citation_breakdown": citation_breakdown,
        "milestones": milestones,
    }

    pdf_bytes = build_monthly_report_pdf(report_payload)
    filename = f"Research-Activity-Report_{month_start.strftime('%Y-%m')}.pdf"

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
