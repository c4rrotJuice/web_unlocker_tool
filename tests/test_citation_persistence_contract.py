from __future__ import annotations

import json
from pathlib import Path
import re
import sqlite3
from typing import Any

import pytest
from fastapi import HTTPException

from app.modules.research.citations.repo import CitationsRepository
from app.modules.research.citations.service import CitationsService
from app.services.citation_domain import ExtractionCandidate, ExtractionPayload, SUPPORTED_RENDER_KINDS


def _schema_render_kinds() -> set[str]:
    migration = Path("writior_migration_pack/005_sources_citations_quotes.sql").read_text(encoding="utf-8")
    match = re.search(r"render_kind text not null check \(render_kind in \(([^)]+)\)\)", migration)
    assert match is not None
    return {value.strip().strip("'") for value in match.group(1).split(",")}


class _SQLiteCitationRepository:
    def __init__(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self._create_schema()

    def _create_schema(self) -> None:
        render_kinds = sorted(_schema_render_kinds())
        placeholders = ", ".join(f"'{kind}'" for kind in render_kinds)
        self.conn.executescript(
            f"""
            create table citation_instances (
              id text primary key,
              user_id text not null,
              source_id text not null,
              locator text not null,
              quote_text text,
              excerpt text,
              annotation text,
              citation_version text not null,
              created_at text not null,
              updated_at text not null
            );

            create table citation_renders (
              id integer primary key autoincrement,
              citation_instance_id text not null references citation_instances(id) on delete cascade,
              source_id text not null,
              style text not null,
              render_kind text not null check (render_kind in ({placeholders})),
              rendered_text text not null,
              cache_key text not null unique,
              source_version text not null,
              citation_version text not null,
              render_version integer not null
            );
            """
        )

    async def create_citation_instance(self, *, user_id, access_token, payload):
        citation_id = f"citation-{self.conn.execute('select count(*) from citation_instances').fetchone()[0] + 1}"
        created_at = "2026-03-22T00:00:00+00:00"
        self.conn.execute(
            """
            insert into citation_instances (
              id, user_id, source_id, locator, quote_text, excerpt, annotation, citation_version, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                citation_id,
                user_id,
                payload["source_id"],
                json.dumps(payload.get("locator") or {}),
                payload.get("quote_text"),
                payload.get("excerpt"),
                payload.get("annotation"),
                payload["citation_version"],
                created_at,
                created_at,
            ),
        )
        self.conn.commit()
        return {
            "id": citation_id,
            "user_id": user_id,
            "source_id": payload["source_id"],
            "locator": payload.get("locator") or {},
            "quote_text": payload.get("quote_text"),
            "excerpt": payload.get("excerpt"),
            "annotation": payload.get("annotation"),
            "citation_version": payload["citation_version"],
            "created_at": created_at,
            "updated_at": created_at,
        }

    async def list_citations(self, *, user_id, access_token, citation_ids=None, source_id=None, limit=50, offset=0):
        rows = self.conn.execute(
            "select id, source_id, locator, quote_text, excerpt, annotation, citation_version, created_at, updated_at from citation_instances where user_id = ? order by created_at desc, id desc",
            (user_id,),
        ).fetchall()
        payload = []
        for row in rows:
            record = {
                "id": row["id"],
                "source_id": row["source_id"],
                "locator": json.loads(row["locator"]),
                "quote_text": row["quote_text"],
                "excerpt": row["excerpt"],
                "annotation": row["annotation"],
                "citation_version": row["citation_version"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            if citation_ids is not None and record["id"] not in citation_ids:
                continue
            if source_id and record["source_id"] != source_id:
                continue
            payload.append(record)
        return payload[offset:offset + limit]

    async def get_citation(self, *, user_id, access_token, citation_id):
        rows = await self.list_citations(user_id=user_id, access_token=access_token, citation_ids=[citation_id], limit=1)
        return rows[0] if rows else None

    async def update_citation(self, *, user_id, access_token, citation_id, payload):
        existing = await self.get_citation(user_id=user_id, access_token=access_token, citation_id=citation_id)
        if existing is None:
            return None
        next_row = {**existing, **payload}
        self.conn.execute(
            """
            update citation_instances
            set locator = ?, quote_text = ?, excerpt = ?, annotation = ?, citation_version = ?, updated_at = ?
            where id = ? and user_id = ?
            """,
            (
                json.dumps(next_row.get("locator") or {}),
                next_row.get("quote_text"),
                next_row.get("excerpt"),
                next_row.get("annotation"),
                next_row["citation_version"],
                existing["updated_at"],
                citation_id,
                user_id,
            ),
        )
        self.conn.commit()
        return next_row

    async def delete_citation(self, *, user_id, access_token, citation_id):
        cursor = self.conn.execute("delete from citation_instances where id = ? and user_id = ?", (citation_id, user_id))
        self.conn.commit()
        return [{"id": citation_id}] if cursor.rowcount else []

    async def list_renders(self, *, citation_ids, access_token):
        if not citation_ids:
            return []
        placeholders = ", ".join("?" for _ in citation_ids)
        rows = self.conn.execute(
            f"select citation_instance_id, style, render_kind, rendered_text, source_version, citation_version, render_version from citation_renders where citation_instance_id in ({placeholders})",
            tuple(citation_ids),
        ).fetchall()
        return [dict(row) for row in rows]

    async def replace_renders(self, *, citation_id, source_id, rows):
        self.conn.execute("delete from citation_renders where citation_instance_id = ?", (citation_id,))
        self.conn.executemany(
            """
            insert into citation_renders (
              citation_instance_id, source_id, style, render_kind, rendered_text, cache_key, source_version, citation_version, render_version
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["citation_instance_id"],
                    row["source_id"],
                    row["style"],
                    row["render_kind"],
                    row["rendered_text"],
                    row["cache_key"],
                    row["source_version"],
                    row["citation_version"],
                    row["render_version"],
                )
                for row in rows
            ],
        )
        self.conn.commit()

    async def list_quote_counts(self, *, user_id, access_token, citation_ids):
        return {citation_id: 0 for citation_id in citation_ids}

    async def list_note_counts(self, *, user_id, access_token, citation_ids):
        return {citation_id: 0 for citation_id in citation_ids}

    async def list_document_counts(self, *, user_id, access_token, citation_ids):
        return {citation_id: 0 for citation_id in citation_ids}


class _StaticSourcesService:
    def __init__(self, source_row: dict[str, Any]):
        self.source_row = source_row

    async def resolve_or_create_source(self, *, access_token, extraction_payload):
        return {
            "id": self.source_row["id"],
            "fingerprint": self.source_row["fingerprint"],
            "title": self.source_row["title"],
            "source_type": self.source_row["source_type"],
            "authors": self.source_row["authors"],
            "container_title": self.source_row["container_title"],
            "publisher": self.source_row["publisher"],
            "issued_date": self.source_row["issued_date"],
            "identifiers": self.source_row["identifiers"],
            "canonical_url": self.source_row["canonical_url"],
            "page_url": self.source_row["page_url"],
            "metadata": self.source_row["metadata"],
            "raw_extraction": self.source_row["raw_extraction"],
            "normalization_version": self.source_row["normalization_version"],
            "source_version": self.source_row["source_version"],
            "hostname": self.source_row["hostname"],
            "language_code": self.source_row["language_code"],
            "created_at": self.source_row["created_at"],
            "updated_at": self.source_row["updated_at"],
        }

    async def get_source_rows_by_ids(self, *, source_ids, access_token):
        return [self.source_row] if self.source_row["id"] in source_ids else []


class _ReplaceRendersFailingRepository(_SQLiteCitationRepository):
    async def replace_renders(self, *, citation_id, source_id, rows):
        raise HTTPException(
            status_code=500,
            detail={
                "code": "CITATION_PERSISTENCE_WRITE_FAILED",
                "message": "Failed to persist citation renders.",
            },
        )


def _canonical_payload() -> ExtractionPayload:
    return ExtractionPayload(
        canonical_url="https://example.com/paper",
        page_url="https://example.com/paper",
        title_candidates=[ExtractionCandidate(value="Canonical paper", confidence=1.0)],
        author_candidates=[ExtractionCandidate(value="Ada Lovelace", confidence=1.0)],
        date_candidates=[ExtractionCandidate(value="2024-02-03", confidence=1.0)],
        locator={"paragraph": 4},
        raw_metadata={"quote": "Quoted sentence", "excerpt": "Quoted sentence"},
    )


def _source_row() -> dict[str, Any]:
    return {
        "id": "source-1",
        "fingerprint": "url:https://example.com/paper",
        "title": "Canonical paper",
        "source_type": "webpage",
        "authors": [{"fullName": "Ada Lovelace", "firstName": "Ada", "lastName": "Lovelace", "initials": "A", "isOrganization": False}],
        "container_title": "",
        "publisher": "Example Publisher",
        "issued_date": {"raw": "2024-02-03", "year": 2024},
        "identifiers": {},
        "canonical_url": "https://example.com/paper",
        "page_url": "https://example.com/paper",
        "metadata": {},
        "raw_extraction": {},
        "normalization_version": 1,
        "source_version": "source-version-1",
        "hostname": "example.com",
        "language_code": "en",
        "created_at": "2026-03-22T00:00:00+00:00",
        "updated_at": "2026-03-22T00:00:00+00:00",
    }


class _FakeResponse:
    def __init__(self, *, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FailingSupabaseRepo:
    def __init__(self):
        self.delete_calls = 0
        self.post_calls = 0

    def headers(self, *, prefer=None, include_content_type=True):
        return {}

    async def delete(self, resource, *, params=None, headers=None):
        self.delete_calls += 1
        return _FakeResponse(status_code=204, payload=None)

    async def post(self, resource, *, params=None, json=None, headers=None):
        self.post_calls += 1
        return _FakeResponse(
            status_code=400,
            payload={
                "code": "23514",
                "message": "new row for relation \"citation_renders\" violates check constraint \"citation_renders_render_kind_check\"",
                "details": "Failing row contains render_kind=quote_attribution.",
            },
        )


def test_runtime_render_kinds_match_canonical_schema_contract():
    assert _schema_render_kinds() == SUPPORTED_RENDER_KINDS


@pytest.mark.anyio
async def test_create_citation_persists_and_hydrates_all_supported_render_kinds_via_db_constraint_path():
    repository = _SQLiteCitationRepository()
    service = CitationsService(repository=repository, sources_service=_StaticSourcesService(_source_row()))

    created = await service.create_citation(
        user_id="user-1",
        access_token=None,
        account_type="pro",
        extraction_payload=_canonical_payload(),
        excerpt="Quoted sentence",
        quote="Quoted sentence",
        locator={"paragraph": 4},
        style="mla",
    )

    assert created["id"]
    assert created["source_id"] == "source-1"
    assert set(created["renders"]["mla"].keys()) == SUPPORTED_RENDER_KINDS
    assert created["renders"]["mla"]["quote_attribution"] == "\"Quoted sentence\" (Lovelace, par. 4)"

    stored_render_kinds = {
        row["render_kind"]
        for row in repository.conn.execute("select render_kind from citation_renders where citation_instance_id = ?", (created["id"],)).fetchall()
    }
    assert stored_render_kinds == SUPPORTED_RENDER_KINDS


@pytest.mark.anyio
async def test_replace_renders_surfaces_constraint_failures_with_upstream_detail(caplog):
    repository = CitationsRepository(supabase_repo=_FailingSupabaseRepo(), anon_key="anon")

    with caplog.at_level("INFO"):
        with pytest.raises(HTTPException) as exc_info:
            await repository.replace_renders(
                citation_id="citation-1",
                source_id="source-1",
                rows=[
                    {
                        "citation_instance_id": "citation-1",
                        "source_id": "source-1",
                        "style": "mla",
                        "render_kind": "quote_attribution",
                        "rendered_text": "\"Quoted sentence\" (Lovelace, par. 4)",
                        "cache_key": "cache-key",
                        "source_version": "source-version-1",
                        "citation_version": "citation-version-1",
                        "render_version": 1,
                    }
                ],
            )

    detail = exc_info.value.detail
    assert exc_info.value.status_code == 500
    assert detail["code"] == "CITATION_PERSISTENCE_WRITE_FAILED"
    assert detail["message"] == "Failed to persist citation renders."
    assert detail["upstream_code"] == "23514"
    assert "quote_attribution" in detail["upstream_details"]
    attempt = next(record for record in caplog.records if record.msg == "citations.replace_renders.attempt")
    failure = next(record for record in caplog.records if record.msg == "citations.replace_renders.failed")
    assert attempt.citation_id == "citation-1"
    assert attempt.render_kinds == ["quote_attribution"]
    assert failure.source_id == "source-1"
    assert failure.styles == ["mla"]
    assert failure.upstream_code == "23514"


@pytest.mark.anyio
async def test_hydration_falls_back_to_in_memory_renders_when_persistence_refresh_fails():
    repository = _ReplaceRendersFailingRepository()
    service = CitationsService(repository=repository, sources_service=_StaticSourcesService(_source_row()))

    created_row = await repository.create_citation_instance(
        user_id="user-1",
        access_token=None,
        payload={
            "source_id": "source-1",
            "locator": {"paragraph": 4},
            "quote_text": "Quoted sentence",
            "excerpt": "Quoted sentence",
            "annotation": None,
            "citation_version": "citation-version-1",
        },
    )

    hydrated = await service.list_citations(
        user_id="user-1",
        access_token=None,
        ids=[created_row["id"]],
        account_type="pro",
    )

    assert len(hydrated) == 1
    assert hydrated[0]["id"] == created_row["id"]
    assert hydrated[0]["renders"]["mla"]["quote_attribution"] == "\"Quoted sentence\" (Lovelace, par. 4)"
