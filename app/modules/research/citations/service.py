from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.core.serialization import serialize_ok_envelope
from app.core.serialization import serialize_paging_meta
from app.core.serialization import serialize_citation, serialize_citation_template, serialize_source_summary
from app.modules.research.citations.repo import CitationsRepository
from app.modules.research.sources.service import SourcesService
from app.services.citation_domain import (
    ExtractionPayload,
    RENDER_VERSION,
    SUPPORTED_STYLES,
    compute_citation_version,
    generate_render_bundle,
    normalize_citation_payload,
)
from app.services.citation_templates import validate_template
from app.services.free_tier_gating import allowed_citation_formats


class CitationsService:
    def __init__(self, *, repository: CitationsRepository, sources_service: SourcesService):
        self.repository = repository
        self.sources_service = sources_service

    def _require_extraction_payload(self, extraction_payload: ExtractionPayload) -> ExtractionPayload:
        if isinstance(extraction_payload, ExtractionPayload):
            return extraction_payload
        raise HTTPException(
            status_code=422,
            detail={
                "code": "EXTRACTION_PAYLOAD_REQUIRED",
                "message": "Canonical extraction payload is required.",
            },
        )

    def _ensure_style_allowed(self, *, account_type: str, style: str | None) -> str:
        selected_style = (style or "mla").strip().lower()
        if selected_style not in allowed_citation_formats(account_type):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "CITATION_FORMAT_LOCKED",
                    "message": "Citation format not available on your plan.",
                    "toast": "Upgrade to unlock this citation format.",
                },
            )
        if selected_style == "custom":
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "CITATION_FORMAT_DEPRECATED",
                    "message": "Custom citation templates are managed separately from citation instance rendering.",
                },
            )
        return selected_style

    def _allowed_styles(self, account_type: str | None) -> set[str]:
        if account_type is None:
            return set(SUPPORTED_STYLES)
        return set(allowed_citation_formats(account_type)) - {"custom"}

    def _filter_renders(self, *, renders: dict[str, dict[str, str]], account_type: str | None, selected_style: str | None = None) -> dict[str, dict[str, str]]:
        allowed_styles = self._allowed_styles(account_type)
        if selected_style:
            return {selected_style: renders.get(selected_style, {})} if selected_style in allowed_styles else {}
        return {style: payload for style, payload in renders.items() if style in allowed_styles}

    def _citation_context(
        self,
        *,
        excerpt: str | None,
        locator: dict[str, Any] | None,
        annotation: str | None,
        quote: str | None,
    ) -> dict[str, Any]:
        citation_context = {
            "locator": locator or {},
            "annotation": annotation or None,
            "excerpt": excerpt or quote or "",
            "quote_text": quote or None,
        }
        citation_context["citation_version"] = compute_citation_version(
            {
                "locator": citation_context["locator"],
                "annotation": citation_context["annotation"] or "",
                "excerpt": citation_context["excerpt"],
                "quote": citation_context["quote_text"] or citation_context["excerpt"],
            }
        )
        return citation_context

    async def _build_render_rows(self, *, citation_id: str, source_id: str, source_row: dict[str, Any], citation_row: dict[str, Any]) -> list[dict[str, Any]]:
        source_payload = {
            "id": source_row.get("id"),
            "title": source_row.get("title"),
            "source_type": source_row.get("source_type"),
            "authors": source_row.get("authors") or [],
            "container_title": source_row.get("container_title"),
            "publisher": source_row.get("publisher"),
            "issued": source_row.get("issued_date") or {},
            "identifiers": source_row.get("identifiers") or {},
            "canonical_url": source_row.get("canonical_url"),
            "page_url": source_row.get("page_url"),
            "metadata": source_row.get("metadata") or {},
            "raw_extraction": source_row.get("raw_extraction") or {},
            "normalization_version": source_row.get("normalization_version"),
            "source_version": source_row.get("source_version"),
            "fingerprint": source_row.get("fingerprint"),
        }
        context_payload = {
            "locator": citation_row.get("locator") or {},
            "annotation": citation_row.get("annotation") or "",
            "excerpt": citation_row.get("excerpt") or "",
            "quote": citation_row.get("quote_text") or citation_row.get("excerpt") or "",
            "citation_version": citation_row.get("citation_version") or "",
        }
        bundle = generate_render_bundle(source_payload, context_payload)
        rows: list[dict[str, Any]] = []
        for style, outputs in bundle["renders"].items():
            for render_kind, rendered_text in outputs.items():
                rows.append(
                    {
                        "citation_instance_id": citation_id,
                        "source_id": source_id,
                        "style": style,
                        "render_kind": render_kind,
                        "rendered_text": rendered_text,
                        "cache_key": f"{bundle['source_version']}:{bundle['citation_version']}:{RENDER_VERSION}:{style}:{render_kind}",
                        "source_version": bundle["source_version"],
                        "citation_version": bundle["citation_version"],
                        "render_version": RENDER_VERSION,
                    }
                )
        return rows

    def _source_detail_to_row(self, source: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": source.get("id"),
            "fingerprint": source.get("fingerprint"),
            "title": source.get("title"),
            "source_type": source.get("source_type"),
            "authors": source.get("authors") or [],
            "container_title": source.get("container_title"),
            "publisher": source.get("publisher"),
            "issued_date": source.get("issued_date") or {},
            "identifiers": source.get("identifiers") or {},
            "canonical_url": source.get("canonical_url"),
            "page_url": source.get("page_url"),
            "metadata": source.get("metadata") or {},
            "raw_extraction": source.get("raw_extraction") or {},
            "normalization_version": source.get("normalization_version"),
            "source_version": source.get("source_version"),
            "hostname": source.get("hostname"),
            "language_code": source.get("language_code"),
            "created_at": source.get("created_at"),
            "updated_at": source.get("updated_at"),
        }

    def _normalized_source_to_row(self, source: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": source.get("id"),
            "fingerprint": source.get("fingerprint"),
            "title": source.get("title"),
            "source_type": source.get("source_type"),
            "authors": source.get("authors") or [],
            "container_title": source.get("container_title"),
            "publisher": source.get("publisher"),
            "issued_date": source.get("issued") or {},
            "identifiers": source.get("identifiers") or {},
            "canonical_url": source.get("canonical_url"),
            "page_url": source.get("page_url"),
            "metadata": source.get("metadata") or {},
            "raw_extraction": source.get("raw_extraction") or {},
            "normalization_version": source.get("normalization_version"),
            "source_version": source.get("source_version"),
            "hostname": source.get("hostname"),
            "language_code": source.get("language_code"),
            "created_at": source.get("created_at"),
            "updated_at": source.get("updated_at"),
        }

    def _serialize_preview(
        self,
        *,
        source_payload: dict[str, Any],
        citation_context: dict[str, Any],
        account_type: str | None,
        selected_style: str,
    ) -> dict[str, Any]:
        source_row = self._normalized_source_to_row(source_payload)
        bundle = generate_render_bundle(source_payload, {
            "locator": citation_context.get("locator") or {},
            "annotation": citation_context.get("annotation") or "",
            "excerpt": citation_context.get("excerpt") or "",
            "quote": citation_context.get("quote_text") or citation_context.get("excerpt") or "",
            "citation_version": citation_context.get("citation_version") or "",
        })
        filtered_renders = self._filter_renders(
            renders=bundle["renders"],
            account_type=account_type,
            selected_style=selected_style,
        )
        return {
            "citation": serialize_citation(
                {
                    "id": None,
                    "source_id": None,
                    "locator": citation_context.get("locator") or {},
                    "annotation": citation_context.get("annotation"),
                    "excerpt": citation_context.get("excerpt"),
                    "quote_text": citation_context.get("quote_text") or citation_context.get("excerpt") or "",
                    "created_at": None,
                    "updated_at": None,
                },
                source=serialize_source_summary(source_row, relationship_counts={}),
                renders=filtered_renders,
                relationship_counts={},
            ),
            "render_bundle": {
                **bundle,
                "renders": filtered_renders,
            },
            "selected_style": selected_style,
        }

    async def preview_citation(
        self,
        *,
        account_type: str,
        extraction_payload: ExtractionPayload,
        excerpt: str | None = None,
        locator: dict[str, Any] | None = None,
        annotation: str | None = None,
        quote: str | None = None,
        style: str | None = None,
    ) -> dict[str, Any]:
        extraction_payload = self._require_extraction_payload(extraction_payload)
        selected_style = self._ensure_style_allowed(account_type=account_type, style=style)
        normalized = normalize_citation_payload(extraction_payload)
        citation_context = self._citation_context(
            excerpt=excerpt or normalized["context"].get("excerpt"),
            locator=locator or normalized["context"].get("locator") or {},
            annotation=annotation or normalized["context"].get("annotation"),
            quote=quote or normalized["context"].get("quote"),
        )
        return self._serialize_preview(
            source_payload=normalized["source"],
            citation_context=citation_context,
            account_type=account_type,
            selected_style=selected_style,
        )

    async def refresh_renders(self, *, access_token: str | None, citation_row: dict[str, Any], source_row: dict[str, Any]) -> None:
        rows = await self._build_render_rows(
            citation_id=str(citation_row["id"]),
            source_id=str(source_row["id"]),
            source_row=source_row,
            citation_row=citation_row,
        )
        await self.repository.replace_renders(citation_id=str(citation_row["id"]), source_id=str(source_row["id"]), rows=rows)

    async def _hydrate(
        self,
        *,
        user_id: str,
        access_token: str | None,
        rows: list[dict],
        preserve_order_ids: list[str] | None = None,
        account_type: str | None = None,
        selected_style: str | None = None,
    ) -> list[dict]:
        if not rows:
            return []
        source_ids: list[str] = []
        seen_source_ids: set[str] = set()
        for row in rows:
            source_id = row.get("source_id")
            if source_id and source_id not in seen_source_ids:
                seen_source_ids.add(source_id)
                source_ids.append(source_id)
        sources = await self.sources_service.get_source_rows_by_ids(source_ids=source_ids, access_token=access_token)
        source_map = {row["id"]: row for row in sources if row.get("id")}
        citation_ids = [row["id"] for row in rows if row.get("id")]
        render_rows = await self.repository.list_renders(citation_ids=citation_ids, access_token=access_token)
        quote_counts = await self.repository.list_quote_counts(user_id=user_id, access_token=access_token, citation_ids=citation_ids)
        note_counts = await self.repository.list_note_counts(user_id=user_id, access_token=access_token, citation_ids=citation_ids)
        document_counts = await self.repository.list_document_counts(user_id=user_id, access_token=access_token, citation_ids=citation_ids)

        render_map: dict[str, dict[str, dict[str, str]]] = {}
        render_versions: dict[str, tuple[str, str]] = {}
        for render_row in render_rows:
            citation_id = render_row.get("citation_instance_id")
            style = render_row.get("style")
            render_kind = render_row.get("render_kind")
            if not citation_id or not style or not render_kind:
                continue
            render_map.setdefault(citation_id, {}).setdefault(style, {})[render_kind] = render_row.get("rendered_text") or ""
            render_versions[citation_id] = (
                str(render_row.get("source_version") or ""),
                str(render_row.get("citation_version") or ""),
            )

        stale_rows: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for row in rows:
            source_row = source_map.get(row.get("source_id"))
            if source_row is None:
                continue
            expected_versions = (str(source_row.get("source_version") or ""), str(row.get("citation_version") or ""))
            if row.get("id") not in render_map or render_versions.get(row.get("id")) != expected_versions:
                stale_rows.append((row, source_row))
        if stale_rows:
            for row, source_row in stale_rows:
                await self.refresh_renders(access_token=access_token, citation_row=row, source_row=source_row)
            refreshed_ids = [str(row["id"]) for row, _source_row in stale_rows if row.get("id")]
            refreshed_render_rows = await self.repository.list_renders(citation_ids=refreshed_ids, access_token=access_token)
            for citation_id in refreshed_ids:
                render_map[citation_id] = {}
            for render_row in refreshed_render_rows:
                citation_id = render_row.get("citation_instance_id")
                style = render_row.get("style")
                render_kind = render_row.get("render_kind")
                if not citation_id or not style or not render_kind:
                    continue
                render_map.setdefault(citation_id, {}).setdefault(style, {})[render_kind] = render_row.get("rendered_text") or ""

        hydrated: list[dict] = []
        for row in rows:
            source_row = source_map.get(row.get("source_id"))
            if source_row is None:
                continue
            hydrated.append(
                serialize_citation(
                    row,
                    source=serialize_source_summary(source_row, relationship_counts={}),
                    renders=self._filter_renders(
                        renders=render_map.get(row["id"], {}),
                        account_type=account_type,
                        selected_style=selected_style,
                    ),
                    relationship_counts={
                        "quote_count": quote_counts.get(row["id"], 0),
                        "note_count": note_counts.get(row["id"], 0),
                        "document_count": document_counts.get(row["id"], 0),
                    },
                )
            )
        if preserve_order_ids:
            by_id = {row["id"]: row for row in hydrated if row.get("id")}
            return [by_id[citation_id] for citation_id in preserve_order_ids if citation_id in by_id]
        return hydrated

    async def list_citations(
        self,
        *,
        user_id: str,
        access_token: str | None,
        ids: list[str] | None = None,
        source_id: str | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
        account_type: str | None = None,
        selected_style: str | None = None,
    ) -> list[dict]:
        rows = await self.repository.list_citations(
            user_id=user_id,
            access_token=access_token,
            citation_ids=ids,
            source_id=source_id,
            limit=limit,
            offset=offset,
        )
        payload = await self._hydrate(
            user_id=user_id,
            access_token=access_token,
            rows=rows,
            preserve_order_ids=ids,
            account_type=account_type,
            selected_style=selected_style,
        )
        if search:
            needle = search.strip().lower()
            payload = [
                item for item in payload
                if needle in str(item.get("excerpt") or "").lower()
                or needle in str((item.get("source") or {}).get("title") or "").lower()
                or needle in str((item.get("source") or {}).get("canonical_url") or "").lower()
            ]
        return payload

    async def list_citations_page(
        self,
        *,
        user_id: str,
        access_token: str | None,
        source_id: str | None = None,
        search: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
        account_type: str | None = None,
    ) -> dict[str, object]:
        offset = int(cursor or "0")
        batch_limit = limit + 1
        items = await self.list_citations(
            user_id=user_id,
            access_token=access_token,
            source_id=source_id,
            search=search,
            limit=batch_limit,
            offset=offset,
            account_type=account_type,
        )
        has_more = len(items) > limit
        page_items = items[:limit]
        next_cursor = str(offset + limit) if has_more else None
        return serialize_ok_envelope(page_items, meta=serialize_paging_meta(next_cursor=next_cursor, has_more=has_more))

    async def get_citation(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str,
        account_type: str | None = None,
        selected_style: str | None = None,
    ) -> dict:
        rows = await self.list_citations(
            user_id=user_id,
            access_token=access_token,
            ids=[citation_id],
            limit=1,
            account_type=account_type,
            selected_style=selected_style,
        )
        if not rows:
            raise HTTPException(status_code=404, detail="Citation not found")
        return rows[0]

    async def create_citation(
        self,
        *,
        user_id: str,
        access_token: str | None,
        account_type: str,
        extraction_payload: ExtractionPayload,
        excerpt: str | None = None,
        locator: dict[str, Any] | None = None,
        annotation: str | None = None,
        quote: str | None = None,
        style: str | None = None,
    ) -> dict:
        extraction_payload = self._require_extraction_payload(extraction_payload)
        self._ensure_style_allowed(account_type=account_type, style=style)
        source = await self.sources_service.resolve_or_create_source(
            access_token=access_token,
            extraction_payload=extraction_payload,
        )
        citation_context = self._citation_context(
            excerpt=excerpt,
            locator=locator,
            annotation=annotation,
            quote=quote,
        )
        row = await self.repository.create_citation_instance(
            user_id=user_id,
            access_token=access_token,
            payload={**citation_context, "source_id": source["id"]},
        )
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create citation instance")
        source_rows = await self.sources_service.get_source_rows_by_ids(source_ids=[source["id"]], access_token=access_token)
        source_row = source_rows[0] if source_rows else self._source_detail_to_row(source)
        await self.refresh_renders(access_token=access_token, citation_row=row, source_row=source_row)
        return await self.get_citation(
            user_id=user_id,
            access_token=access_token,
            citation_id=str(row["id"]),
            account_type=account_type,
        )

    async def update_citation(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str,
        payload: dict[str, Any],
    ) -> dict:
        existing = await self.repository.get_citation(user_id=user_id, access_token=access_token, citation_id=citation_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Citation not found")
        next_row = {
            "locator": payload.get("locator", existing.get("locator") or {}),
            "annotation": payload.get("annotation", existing.get("annotation")),
            "excerpt": payload.get("excerpt", existing.get("excerpt")),
            "quote_text": payload.get("quote", existing.get("quote_text")),
        }
        next_row["citation_version"] = compute_citation_version(
            {
                "locator": next_row["locator"] or {},
                "annotation": next_row.get("annotation") or "",
                "excerpt": next_row.get("excerpt") or "",
                "quote": next_row.get("quote_text") or next_row.get("excerpt") or "",
            }
        )
        row = await self.repository.update_citation(
            user_id=user_id,
            access_token=access_token,
            citation_id=citation_id,
            payload=next_row,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Citation not found")
        source_row = (await self.sources_service.get_source_rows_by_ids(source_ids=[row["source_id"]], access_token=access_token))[0]
        await self.refresh_renders(access_token=access_token, citation_row=row, source_row=source_row)
        return await self.get_citation(user_id=user_id, access_token=access_token, citation_id=citation_id)

    async def delete_citation(self, *, user_id: str, access_token: str | None, citation_id: str) -> dict:
        rows = await self.repository.delete_citation(user_id=user_id, access_token=access_token, citation_id=citation_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Citation not found")
        return {"ok": True, "id": citation_id}

    async def render_citation(
        self,
        *,
        user_id: str,
        access_token: str | None,
        citation_id: str,
        style: str | None,
        account_type: str | None,
    ) -> dict:
        normalized_style = (style or "mla").strip().lower()
        if normalized_style not in SUPPORTED_STYLES:
            raise HTTPException(status_code=422, detail={"code": "CITATION_STYLE_UNSUPPORTED", "message": "Unsupported citation style."})
        if normalized_style not in self._allowed_styles(account_type):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "CITATION_FORMAT_LOCKED",
                    "message": "Citation format not available on your plan.",
                    "toast": "Upgrade to unlock this citation format.",
                },
            )
        return await self.get_citation(
            user_id=user_id,
            access_token=access_token,
            citation_id=citation_id,
            account_type=account_type,
            selected_style=normalized_style,
        )

    def _require_template_capability(self, account_type: str) -> None:
        if "custom" not in allowed_citation_formats(account_type):
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "CITATION_TEMPLATE_PRO_ONLY",
                    "message": "Custom citation templates are available on Pro only.",
                    "toast": "Upgrade to Pro to use custom citation templates.",
                },
            )

    async def list_templates(self, *, user_id: str, access_token: str | None, account_type: str) -> list[dict]:
        self._require_template_capability(account_type)
        rows = await self.repository.list_templates(user_id=user_id, access_token=access_token)
        return [serialize_citation_template(row) for row in rows]

    async def create_template(self, *, user_id: str, access_token: str | None, account_type: str, payload: dict[str, Any]) -> dict:
        self._require_template_capability(account_type)
        ok, error = validate_template(str(payload.get("template_body") or ""))
        if not ok:
            raise HTTPException(status_code=422, detail=error)
        row = await self.repository.create_template(user_id=user_id, access_token=access_token, payload=payload)
        if row is None:
            raise HTTPException(status_code=500, detail="Failed to create citation template")
        return serialize_citation_template(row)

    async def update_template(self, *, user_id: str, access_token: str | None, account_type: str, template_id: str, payload: dict[str, Any]) -> dict:
        self._require_template_capability(account_type)
        if payload.get("template_body") is not None:
            ok, error = validate_template(str(payload.get("template_body") or ""))
            if not ok:
                raise HTTPException(status_code=422, detail=error)
        row = await self.repository.update_template(user_id=user_id, access_token=access_token, template_id=template_id, payload=payload)
        if row is None:
            raise HTTPException(status_code=404, detail="Template not found")
        return serialize_citation_template(row)

    async def delete_template(self, *, user_id: str, access_token: str | None, account_type: str, template_id: str) -> dict:
        self._require_template_capability(account_type)
        rows = await self.repository.delete_template(user_id=user_id, access_token=access_token, template_id=template_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"ok": True, "id": template_id}
