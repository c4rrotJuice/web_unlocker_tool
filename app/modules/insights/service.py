from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.core.entitlements import require_capability
from app.core.serialization import (
    serialize_citation_style_insight,
    serialize_domain_insight,
    serialize_milestone,
    serialize_module_status,
    serialize_monthly_report,
    serialize_monthly_summary,
    serialize_momentum_summary,
    serialize_ok_envelope,
)
from app.modules.insights.repo import InsightsRepository
from app.services.momentum import MILESTONE_CONFIG, calculate_streak, count_active_days_in_range


class InsightsService:
    def __init__(self, *, repository: InsightsRepository, contract: str):
        self.repository = repository
        self.contract = contract

    def status(self) -> dict[str, object]:
        return serialize_module_status(
            module="insights",
            contract=self.contract,
            notes=[
                "Insights and reports are derivative reads over canonical activity, document, milestone, and citation structures.",
                "No milestone writes occur during insights reads.",
            ],
        )

    def _milestone_title_map(self) -> dict[str, str]:
        return {milestone.key: milestone.title for milestone in MILESTONE_CONFIG}

    def _resolve_timezone(self, timezone_name: str | None) -> ZoneInfo:
        if not timezone_name:
            return ZoneInfo("UTC")
        try:
            return ZoneInfo(timezone_name)
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid timezone.") from exc

    def _month_bounds(self, *, month: str | None, timezone_name: str | None) -> dict[str, object]:
        tz = self._resolve_timezone(timezone_name)
        if month:
            try:
                month_start_date = date.fromisoformat(f"{month}-01")
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="month must use YYYY-MM format.") from exc
        else:
            month_start_date = datetime.now(tz).date().replace(day=1)
        if month_start_date.month == 12:
            next_month_date = date(month_start_date.year + 1, 1, 1)
        else:
            next_month_date = date(month_start_date.year, month_start_date.month + 1, 1)
        start_dt_local = datetime(month_start_date.year, month_start_date.month, 1, tzinfo=tz)
        next_month_dt_local = datetime(next_month_date.year, next_month_date.month, 1, tzinfo=tz)
        return {
            "month": month_start_date.strftime("%Y-%m"),
            "timezone": getattr(tz, "key", str(tz)),
            "month_start_date": month_start_date,
            "next_month_date": next_month_date,
            "month_start_utc": start_dt_local.astimezone(timezone.utc),
            "next_month_utc": next_month_dt_local.astimezone(timezone.utc),
            "range": {
                "start": start_dt_local.astimezone(timezone.utc).isoformat(),
                "end": next_month_dt_local.astimezone(timezone.utc).isoformat(),
            },
        }

    async def _momentum_payload(self, *, user_id: str, bounds: dict[str, object]) -> dict[str, object]:
        month_start_date = bounds["month_start_date"]
        next_month_date = bounds["next_month_date"]
        timezone_name = str(bounds["timezone"])
        today_local = datetime.now(self._resolve_timezone(timezone_name)).date()
        unlock_days = await self.repository.get_unlock_days(
            user_id=user_id,
            start_date=month_start_date - timedelta(days=31),
            end_date=today_local,
        )
        current_streak_days, _has_unlock_today = calculate_streak(unlock_days, today_local)
        active_days_this_month = count_active_days_in_range(unlock_days, month_start_date, next_month_date)
        start_at = bounds["month_start_utc"].isoformat()
        end_at = bounds["next_month_utc"].isoformat()
        unlocks_this_month = await self.repository.count_unlock_events(
            user_id=user_id,
            start_at=start_at,
            end_at=end_at,
            event_type="unlock",
        )
        captures_this_month = await self.repository.count_unlock_events(
            user_id=user_id,
            start_at=start_at,
            end_at=end_at,
            event_type="selection_capture",
        )
        copy_assists_this_month = await self.repository.count_unlock_events(
            user_id=user_id,
            start_at=start_at,
            end_at=end_at,
            event_type="copy_assist",
        )
        total_activity_this_month = await self.repository.count_unlock_events(
            user_id=user_id,
            start_at=start_at,
            end_at=end_at,
            event_type=None,
        )
        documents_updated_this_month = await self.repository.count_documents_updated(
            user_id=user_id,
            start_at=start_at,
            end_at=end_at,
        )
        return serialize_momentum_summary(
            {
                "current_streak_days": current_streak_days,
                "active_days_this_month": active_days_this_month,
                "unlocks_this_month": unlocks_this_month,
                "captures_this_month": captures_this_month,
                "copy_assists_this_month": copy_assists_this_month,
                "total_activity_this_month": total_activity_this_month,
                "documents_updated_this_month": documents_updated_this_month,
            }
        )

    async def momentum(self, *, user_id: str, month: str | None, timezone_name: str | None) -> dict[str, object]:
        bounds = self._month_bounds(month=month, timezone_name=timezone_name)
        return serialize_ok_envelope(await self._momentum_payload(user_id=user_id, bounds=bounds))

    async def domain_summary(self, *, user_id: str, month: str | None, timezone_name: str | None) -> dict[str, object]:
        bounds = self._month_bounds(month=month, timezone_name=timezone_name)
        rows = await self.repository.get_monthly_domain_counts(
            user_id=user_id,
            month_start=bounds["month_start_date"],
            month_end=bounds["next_month_date"] - timedelta(days=1),
        )
        data = [
            serialize_domain_insight({"domain": row.get("domain"), "count": row.get("unlock_count") or row.get("count")})
            for row in rows
            if row.get("domain")
        ]
        return serialize_ok_envelope(data)

    async def citation_style_summary(self, *, user_id: str, month: str | None, timezone_name: str | None) -> dict[str, object]:
        bounds = self._month_bounds(month=month, timezone_name=timezone_name)
        rows = await self.repository.get_monthly_citation_breakdown(
            user_id=user_id,
            month_start=bounds["month_start_date"],
            month_end=bounds["next_month_date"] - timedelta(days=1),
        )
        data = [
            serialize_citation_style_insight({"style": row.get("style"), "count": row.get("citation_count") or row.get("count")})
            for row in rows
            if row.get("style")
        ]
        return serialize_ok_envelope(data)

    async def monthly_summary(self, *, user_id: str, month: str | None, timezone_name: str | None) -> dict[str, object]:
        bounds = self._month_bounds(month=month, timezone_name=timezone_name)
        momentum = await self._momentum_payload(user_id=user_id, bounds=bounds)
        domains_response = await self.domain_summary(user_id=user_id, month=bounds["month"], timezone_name=bounds["timezone"])
        citation_styles_response = await self.citation_style_summary(user_id=user_id, month=bounds["month"], timezone_name=bounds["timezone"])
        milestone_rows = await self.repository.list_milestones(
            user_id=user_id,
            month_start=bounds["month_start_utc"].isoformat(),
            month_end=bounds["next_month_utc"].isoformat(),
        )
        label_map = self._milestone_title_map()
        milestones = [
            serialize_milestone(row, label=label_map.get(str(row.get("milestone_key")), str(row.get("milestone_key"))))
            for row in milestone_rows
        ]
        report = serialize_monthly_report(
            {
                "month": bounds["month"],
                "range": bounds["range"],
                "status": "ready",
                "available": False,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "download_url": None,
                "supported_formats": ["pdf"],
                "sections": {
                    "momentum": momentum,
                    "domains": domains_response["data"],
                    "citation_styles": citation_styles_response["data"],
                    "milestones": milestones,
                },
                "completeness": 1.0,
                "missing_sections": [],
                "timezone": bounds["timezone"],
            }
        )
        return serialize_ok_envelope(
            serialize_monthly_summary(
                {
                    "month": bounds["month"],
                    "range": bounds["range"],
                    "timezone": bounds["timezone"],
                    "momentum": momentum,
                    "domains": domains_response["data"],
                    "citation_styles": citation_styles_response["data"],
                    "milestones": milestones,
                    "report": {
                        "available": report["available"],
                        "status": report["status"],
                        "supported_formats": report["supported_formats"],
                        "download_url": report["download_url"],
                    },
                }
            )
        )

    async def monthly_report(self, *, user_id: str, capability_state, month: str | None, timezone_name: str | None) -> dict[str, object]:
        require_capability("reports", capability_state)
        bounds = self._month_bounds(month=month, timezone_name=timezone_name)
        summary = await self.monthly_summary(user_id=user_id, month=bounds["month"], timezone_name=bounds["timezone"])
        sections = {
            "momentum": summary["data"]["momentum"],
            "domains": summary["data"]["domains"],
            "citation_styles": summary["data"]["citation_styles"],
            "milestones": summary["data"]["milestones"],
        }
        missing_sections = [name for name, value in sections.items() if not value]
        completeness = round((len(sections) - len(missing_sections)) / len(sections), 2)
        return serialize_ok_envelope(
            serialize_monthly_report(
                {
                    "month": bounds["month"],
                    "range": bounds["range"],
                    "status": "ready",
                    "available": False,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "download_url": None,
                    "supported_formats": ["pdf"],
                    "sections": sections,
                    "completeness": completeness,
                    "missing_sections": missing_sections,
                    "timezone": bounds["timezone"],
                }
            )
        )
