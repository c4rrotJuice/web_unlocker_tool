import importlib
import asyncio
import json
import subprocess
import textwrap
from types import SimpleNamespace

import supabase


class DummyUser:
    def __init__(self, user_id: str):
        self.id = user_id
        self.email = f"{user_id}@example.com"


class DummyAuth:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def get_user(self, _token):
        return type("DummyUserResponse", (), {"user": DummyUser(self.user_id)})


class DummyInsert:
    def execute(self):
        return type("DummyInsertResponse", (), {"data": [{"id": 1}]})


class DummyTable:
    def select(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def single(self, *args, **kwargs):
        return self

    def insert(self, *args, **kwargs):
        return DummyInsert()

    def execute(self):
        return type("DummyExecute", (), {"data": {"name": "Tester", "account_type": "standard", "daily_limit": 5}})


class DummyClient:
    def __init__(self, user_id: str):
        self.auth = DummyAuth(user_id)

    def table(self, *args, **kwargs):
        return DummyTable()


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else [{"id": "ok"}]
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeSupabaseRepo:
    def __init__(self):
        self.calls = []
        self.notes = {}
        self.note_sources = {}
        self.note_links = {}

    def headers(self, **kwargs):
        return {"x-test": "1", **({"prefer": kwargs.get("prefer")} if kwargs.get("prefer") else {})}

    async def get(self, resource, **kwargs):
        self.calls.append(("get", resource, kwargs))
        if resource == "tags":
            params = kwargs.get("params", {})
            ids_filter = params.get("id", "")
            if ids_filter.startswith("in.("):
                ids = [item.strip() for item in ids_filter[4:-1].split(",") if item.strip()]
                return FakeResponse(200, [{"id": tag_id} for tag_id in ids])
            return FakeResponse(200, [])
        if resource == "note_sources":
            params = kwargs.get("params", {})
            note_filter = params.get("note_id", "")
            if note_filter.startswith("eq."):
                note_id = note_filter.replace("eq.", "")
                return FakeResponse(200, list(self.note_sources.get(note_id, [])))
            if note_filter.startswith("in.("):
                note_ids = [item.strip() for item in note_filter[4:-1].split(",") if item.strip()]
                rows = []
                for note_id in note_ids:
                    rows.extend([{"note_id": note_id, **row} for row in self.note_sources.get(note_id, [])])
                return FakeResponse(200, rows)
            return FakeResponse(200, [])
        if resource == "notes" and kwargs.get("params", {}).get("id", "").startswith("eq."):
            note_id = kwargs["params"]["id"].replace("eq.", "")
            note = self.notes.get(note_id)
            if note:
                return FakeResponse(200, [note])
            return FakeResponse(200, [{
                "id": note_id,
                "user_id": "user-notes",
                "title": "Research note",
                "highlight_text": "Highlighted sentence",
                "note_body": "Body",
                "source_url": "https://example.com/paper",
                "source_title": "Paper Title",
                "source_author": None,
                "source_published_at": None,
                "source_domain": "example.com",
                "project_id": None,
                "citation_id": None,
                "quote_id": None,
                "archived_at": None,
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }])
        if resource == "notes":
            rows = list(self.notes.values()) or [{"id": "n"}]
            return FakeResponse(200, rows, headers={"content-range": f"0-{max(len(rows) - 1, 0)}/17"})
        return FakeResponse(200, [{"id": "n"}], headers={"content-range": "0-0/17"})

    async def post(self, resource, **kwargs):
        self.calls.append(("post", resource, kwargs))
        if resource == "notes":
            payload = kwargs.get("json", {})
            note_id = payload.get("id", "n")
            stored = {
                "id": note_id,
                "user_id": "user-notes",
                "title": payload.get("title"),
                "highlight_text": payload.get("highlight_text"),
                "note_body": payload.get("note_body"),
                "source_url": payload.get("source_url"),
                "source_title": payload.get("source_title"),
                "source_author": payload.get("source_author"),
                "source_published_at": payload.get("source_published_at"),
                "source_domain": "example.com",
                "project_id": payload.get("project_id"),
                "citation_id": payload.get("citation_id"),
                "quote_id": payload.get("quote_id"),
                "archived_at": None,
                "created_at": payload.get("created_at"),
                "updated_at": payload.get("updated_at"),
            }
            self.notes[note_id] = stored
            return FakeResponse(201, [stored])
        return FakeResponse(201, [{"id": "n"}])

    async def patch(self, resource, **kwargs):
        self.calls.append(("patch", resource, kwargs))
        if resource == "notes":
            params = kwargs.get("params", {})
            note_id = params.get("id", "").replace("eq.", "")
            current = self.notes.get(note_id, {
                "id": note_id,
                "user_id": "user-notes",
                "source_domain": "example.com",
                "archived_at": None,
            })
            current.update(kwargs.get("json", {}))
            self.notes[note_id] = current
            return FakeResponse(200, [current])
        return FakeResponse(200, [{"id": "n"}])

    async def delete(self, resource, **kwargs):
        self.calls.append(("delete", resource, kwargs))
        return FakeResponse(204, [])

    async def rpc(self, function_name, **kwargs):
        self.calls.append(("rpc", function_name, kwargs))
        payload = kwargs.get("json") or {}
        if function_name == "replace_note_tag_links_atomic":
            return FakeResponse(200, payload.get("p_tag_ids", []))
        if function_name == "replace_note_sources_atomic":
            self.note_sources[payload.get("p_note_id")] = list(payload.get("p_sources", []))
            return FakeResponse(200, payload.get("p_sources", []))
        if function_name == "replace_note_links_atomic":
            self.note_links[payload.get("p_note_id")] = list(payload.get("p_linked_note_ids", []))
            return FakeResponse(200, payload.get("p_linked_note_ids", []))
        if function_name == "replace_document_citations_atomic":
            return FakeResponse(200, payload.get("p_citation_ids", []))
        return FakeResponse(404, {"message": f'function "{function_name}" does not exist'})


def _build_app(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service")
    monkeypatch.setattr(supabase, "create_client", lambda url, key: DummyClient("user-notes"))

    from app import main

    importlib.reload(main)

    async def redis_get(_key):
        return 0

    async def redis_incr(_key):
        return 1

    async def redis_expire(_key, _seconds):
        return True

    main.app.state.redis_get = redis_get
    main.app.state.redis_incr = redis_incr
    main.app.state.redis_expire = redis_expire
    main.app.state.http_session = None
    return main


def _request(user_id: str = "user-notes"):
    app_state = SimpleNamespace(
        redis_get=lambda *_args, **_kwargs: 0,
        redis_incr=lambda *_args, **_kwargs: 1,
        redis_expire=lambda *_args, **_kwargs: True,
    )
    return SimpleNamespace(state=SimpleNamespace(user_id=user_id, account_type="standard"), app=SimpleNamespace(state=app_state))


def _run_note_sync_module(script_body: str):
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            textwrap.dedent(
                f"""
                import {{
                  buildCanonicalNotePayloadBase,
                  buildCanonicalSources,
                  normalizeQueuedOperation,
                }} from "./extension/lib/note_sync.js";

                {script_body}
                """
            ),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_notes_create_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePayload(
        id="2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        title="Title",
        note_body="Body",
        source_url="https://example.com/a",
        tags=["43f2fbbf-2390-4ea3-bfc4-28ea0803aca7"],
    )

    response = asyncio.run(extension.create_note(_request(), payload))

    assert response["ok"] is True
    assert any(call[0] == "post" and call[1] == "notes" for call in repo.calls)
    assert any(call[0] == "rpc" and call[1] == "replace_note_tag_links_atomic" for call in repo.calls)


def test_notes_create_sync_preserves_rich_metadata_and_sources(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePayload(
        id="2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        title="Rich note",
        highlight_text="Quoted highlight",
        note_body="Body",
        source_url="https://example.com/paper",
        source_title="Paper Title",
        source_author="A. Writer",
        source_published_at="2026-02-03T04:05:06Z",
        citation_id="c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88",
        quote_id="c48b1b8d-03a8-41b2-81f3-7c6a5317d701",
        created_at="2026-02-04T01:02:03Z",
        updated_at="2026-02-05T01:02:03Z",
        sources=[
            {
                "url": "https://example.com/paper",
                "title": "Paper Title",
                "hostname": "example.com",
                "source_author": "A. Writer",
                "source_published_at": "2026-02-03T04:05:06Z",
                "attached_at": "2026-02-04T01:02:03Z",
            }
        ],
        tags=["43f2fbbf-2390-4ea3-bfc4-28ea0803aca7"],
    )

    response = asyncio.run(extension.create_note(_request(), payload))

    assert response["ok"] is True
    note_post = [call for call in repo.calls if call[0] == "post" and call[1] == "notes"][0]
    assert note_post[2]["json"]["highlight_text"] == "Quoted highlight"
    assert note_post[2]["json"]["source_url"] == "https://example.com/paper"
    assert note_post[2]["json"]["source_title"] == "Paper Title"
    assert note_post[2]["json"]["source_author"] == "A. Writer"
    assert note_post[2]["json"]["source_published_at"] == "2026-02-03T04:05:06+00:00"
    assert note_post[2]["json"]["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert note_post[2]["json"]["quote_id"] == "c48b1b8d-03a8-41b2-81f3-7c6a5317d701"
    assert note_post[2]["json"]["created_at"] == "2026-02-04T01:02:03+00:00"
    assert note_post[2]["json"]["updated_at"] == "2026-02-05T01:02:03+00:00"

    source_write = [call for call in repo.calls if call[0] == "rpc" and call[1] == "replace_note_sources_atomic"][0]
    assert source_write[2]["json"]["p_sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Paper Title",
            "hostname": "example.com",
            "source_author": "A. Writer",
            "source_published_at": "2026-02-03T04:05:06+00:00",
            "attached_at": "2026-02-04T01:02:03+00:00",
        }
    ]

    listed = asyncio.run(extension.list_notes(_request()))
    assert listed["notes"][0]["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Paper Title",
            "hostname": "example.com",
            "source_author": "A. Writer",
            "source_published_at": "2026-02-03T04:05:06+00:00",
            "attached_at": "2026-02-04T01:02:03+00:00",
        }
    ]


def test_queue_preserves_metadata_before_and_after_rehydration():
    payload = _run_note_sync_module(
        """
        const operation = normalizeQueuedOperation({
          type: "create",
          note: {
            id: "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
            title: "Rich queued note",
            highlight_text: "Queued highlight",
            note_body: "Queued body",
            source_url: "https://example.com/paper",
            source_title: "Paper Title",
            source_author: "A. Writer",
            source_published_at: "2026-02-03T04:05:06Z",
            sources: [
              {
                url: "https://example.com/paper",
                title: "Paper Title",
                hostname: "example.com",
                source_author: "A. Writer",
                source_published_at: "2026-02-03T04:05:06Z",
                attached_at: "2026-02-04T01:02:03Z"
              }
            ],
            citation_id: "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88",
            quote_id: "c48b1b8d-03a8-41b2-81f3-7c6a5317d701",
            project_id: "34afed2a-616b-4f02-95b0-cf48c109a5d5",
            tags: ["tag-local-1"],
            created_at: "2026-02-04T01:02:03Z",
            updated_at: "2026-02-05T01:02:03Z",
            custom_field: "preserve-me"
          }
        }, { queuedAt: "2026-02-06T01:02:03Z" });

        const rehydrated = JSON.parse(JSON.stringify(operation));
        const replayPayload = buildCanonicalNotePayloadBase(rehydrated.note, {
          project_id: rehydrated.note.project_id,
          tag_ids: ["canonical-tag-1"],
          now: "2026-02-07T01:02:03Z"
        });

        console.log(JSON.stringify({ operation, rehydrated, replayPayload }));
        """
    )

    queued_note = payload["operation"]["note"]
    rehydrated_note = payload["rehydrated"]["note"]
    replay_payload = payload["replayPayload"]

    assert queued_note["id"] == "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    assert queued_note["source_title"] == "Paper Title"
    assert queued_note["source_author"] == "A. Writer"
    assert queued_note["source_published_at"] == "2026-02-03T04:05:06Z"
    assert queued_note["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Paper Title",
            "hostname": "example.com",
            "source_author": "A. Writer",
            "source_published_at": "2026-02-03T04:05:06Z",
            "attached_at": "2026-02-04T01:02:03Z",
        }
    ]
    assert queued_note["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert queued_note["quote_id"] == "c48b1b8d-03a8-41b2-81f3-7c6a5317d701"
    assert queued_note["created_at"] == "2026-02-04T01:02:03Z"
    assert queued_note["updated_at"] == "2026-02-05T01:02:03Z"
    assert queued_note["custom_field"] == "preserve-me"

    assert rehydrated_note == queued_note

    assert replay_payload["source_title"] == "Paper Title"
    assert replay_payload["source_author"] == "A. Writer"
    assert replay_payload["source_published_at"] == "2026-02-03T04:05:06Z"
    assert replay_payload["sources"] == queued_note["sources"]
    assert replay_payload["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert replay_payload["quote_id"] == "c48b1b8d-03a8-41b2-81f3-7c6a5317d701"
    assert replay_payload["created_at"] == "2026-02-04T01:02:03Z"
    assert replay_payload["updated_at"] == "2026-02-05T01:02:03Z"


def test_queue_replay_after_offline_creation_preserves_metadata():
    payload = _run_note_sync_module(
        """
        const storedQueue = [];
        const operation = normalizeQueuedOperation({
          type: "create",
          note: {
            id: "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
            source_url: "https://example.com/paper",
            source_title: "Paper Title",
            source_author: "A. Writer",
            source_published_at: "2026-02-03T04:05:06Z",
            citation_id: "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88",
            quote_id: "c48b1b8d-03a8-41b2-81f3-7c6a5317d701",
            created_at: "2026-02-04T01:02:03Z",
            updated_at: "2026-02-05T01:02:03Z",
            unknown_flag: true
          }
        }, { queuedAt: "2026-02-06T01:02:03Z" });
        storedQueue.push(operation);

        const rehydratedQueue = JSON.parse(JSON.stringify(storedQueue));
        const replayPayload = buildCanonicalNotePayloadBase(rehydratedQueue[0].note, {
          project_id: null,
          tag_ids: [],
          now: "2026-02-07T01:02:03Z"
        });

        console.log(JSON.stringify({ storedQueue, rehydratedQueue, replayPayload }));
        """
    )

    stored_note = payload["storedQueue"][0]["note"]
    rehydrated_note = payload["rehydratedQueue"][0]["note"]

    assert stored_note == rehydrated_note
    assert stored_note["source_title"] == "Paper Title"
    assert stored_note["source_author"] == "A. Writer"
    assert stored_note["source_published_at"] == "2026-02-03T04:05:06Z"
    assert stored_note["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert stored_note["quote_id"] == "c48b1b8d-03a8-41b2-81f3-7c6a5317d701"
    assert stored_note["created_at"] == "2026-02-04T01:02:03Z"
    assert stored_note["updated_at"] == "2026-02-05T01:02:03Z"
    assert stored_note["unknown_flag"] is True
    assert payload["replayPayload"]["source_title"] == "Paper Title"
    assert payload["replayPayload"]["source_author"] == "A. Writer"
    assert payload["replayPayload"]["source_published_at"] == "2026-02-03T04:05:06Z"
    assert payload["replayPayload"]["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert payload["replayPayload"]["quote_id"] == "c48b1b8d-03a8-41b2-81f3-7c6a5317d701"


def test_source_synthesis_create_and_update_do_not_duplicate():
    payload = _run_note_sync_module(
        """
        const createNote = {
          id: "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
          source_url: "https://example.com/paper",
          source_title: "Paper Title",
          source_author: "A. Writer",
          created_at: "2026-02-04T01:02:03Z"
        };
        const createPayload = buildCanonicalNotePayloadBase(createNote, {
          project_id: null,
          tag_ids: [],
          now: "2026-02-07T01:02:03Z"
        });

        const updatePayload = buildCanonicalNotePayloadBase({
          ...createNote,
          updated_at: "2026-02-08T01:02:03Z"
        }, {
          project_id: null,
          tag_ids: [],
          now: "2026-02-08T01:02:03Z"
        });

        const explicitUpdatePayload = buildCanonicalNotePayloadBase({
          ...createNote,
          source_url: "https://example.com/ignored-by-explicit",
          sources: [
            {
              url: "https://example.com/paper",
              title: "Explicit Source",
              hostname: "example.com",
              attached_at: "2026-02-04T01:02:03Z",
              annotation: "keep-me"
            },
            {
              url: "https://example.com/paper",
              title: "Duplicate Source",
              hostname: "example.com",
              attached_at: "2026-02-05T01:02:03Z"
            }
          ]
        }, {
          project_id: null,
          tag_ids: [],
          now: "2026-02-09T01:02:03Z"
        });

        console.log(JSON.stringify({ createPayload, updatePayload, explicitUpdatePayload }));
        """
    )

    assert payload["createPayload"]["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Paper Title",
            "hostname": "example.com",
            "source_author": "A. Writer",
            "source_published_at": None,
            "attached_at": "2026-02-04T01:02:03.000Z",
        }
    ]
    assert len(payload["updatePayload"]["sources"]) == 1
    assert payload["updatePayload"]["sources"][0]["url"] == "https://example.com/paper"
    assert payload["updatePayload"]["sources"][0]["title"] == "Paper Title"
    assert payload["updatePayload"]["sources"][0]["source_author"] == "A. Writer"
    assert payload["updatePayload"]["sources"][0]["source_published_at"] is None

    assert payload["explicitUpdatePayload"]["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Explicit Source",
            "hostname": "example.com",
            "attached_at": "2026-02-04T01:02:03Z",
            "annotation": "keep-me",
        }
    ]


def test_synthesized_sources_include_note_level_author_and_published_at():
    payload = _run_note_sync_module(
        """
        const replayPayload = buildCanonicalNotePayloadBase({
          id: "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
          source_url: "https://example.com/paper",
          source_title: "Paper Title",
          source_author: "A. Writer",
          source_published_at: "2026-02-03T04:05:06Z",
          created_at: "2026-02-04T01:02:03Z"
        }, {
          project_id: null,
          tag_ids: [],
          now: "2026-02-07T01:02:03Z"
        });
        console.log(JSON.stringify(replayPayload));
        """
    )

    assert payload["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Paper Title",
            "hostname": "example.com",
            "source_author": "A. Writer",
            "source_published_at": "2026-02-03T04:05:06Z",
            "attached_at": "2026-02-04T01:02:03.000Z",
        }
    ]


def test_notes_without_source_metadata_fields_still_work_unchanged():
    payload = _run_note_sync_module(
        """
        const replayPayload = buildCanonicalNotePayloadBase({
          id: "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
          source_url: "https://example.com/paper",
          source_title: "Paper Title",
          created_at: "2026-02-04T01:02:03Z"
        }, {
          project_id: null,
          tag_ids: [],
          now: "2026-02-07T01:02:03Z"
        });
        console.log(JSON.stringify(replayPayload));
        """
    )

    assert payload["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Paper Title",
            "hostname": "example.com",
            "source_author": None,
            "source_published_at": None,
            "attached_at": "2026-02-04T01:02:03.000Z",
        }
    ]


def test_notes_update_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePatchRequest(
        id="2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        title="Title2",
        note_body="Body2",
        tags=[],
    )

    response = asyncio.run(extension.update_note(_request(), payload))

    assert response["ok"] is True
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)


def test_notes_update_sync_preserves_rich_metadata(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePatchRequest(
        id="2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        source_title="Updated Title",
        source_author="Updated Author",
        source_published_at="2026-02-06T07:08:09Z",
        citation_id="c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88",
        quote_id="c48b1b8d-03a8-41b2-81f3-7c6a5317d701",
        updated_at="2026-02-07T01:02:03Z",
    )

    response = asyncio.run(extension.update_note(_request(), payload))

    assert response["ok"] is True
    patch_call = [call for call in repo.calls if call[0] == "patch" and call[1] == "notes"][0]
    assert patch_call[2]["json"]["source_title"] == "Updated Title"
    assert patch_call[2]["json"]["source_author"] == "Updated Author"
    assert patch_call[2]["json"]["source_published_at"] == "2026-02-06T07:08:09+00:00"
    assert patch_call[2]["json"]["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert patch_call[2]["json"]["quote_id"] == "c48b1b8d-03a8-41b2-81f3-7c6a5317d701"
    assert patch_call[2]["json"]["updated_at"] == "2026-02-07T01:02:03+00:00"


def test_notes_update_readback_preserves_explicit_source_metadata(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    repo.notes[note_id] = {
        "id": note_id,
        "user_id": "user-notes",
        "title": "Existing",
        "highlight_text": None,
        "note_body": "Body",
        "source_url": "https://example.com/paper",
        "source_title": "Paper Title",
        "source_author": "A. Writer",
        "source_published_at": "2026-02-03T04:05:06+00:00",
        "source_domain": "example.com",
        "project_id": None,
        "citation_id": None,
        "quote_id": None,
        "archived_at": None,
        "created_at": "2026-02-04T01:02:03+00:00",
        "updated_at": "2026-02-04T01:02:03+00:00",
    }

    payload = extension.ExtensionNotePatchRequest(
        id=note_id,
        sources=[
            {
                "url": "https://example.com/paper",
                "title": "Updated Source",
                "hostname": "example.com",
                "source_author": "Updated Author",
                "source_published_at": "2026-02-06T07:08:09Z",
                "attached_at": "2026-02-07T01:02:03Z",
            }
        ],
        updated_at="2026-02-07T01:02:03Z",
    )

    response = asyncio.run(extension.update_note(_request(), payload))

    assert response["ok"] is True
    listed = asyncio.run(extension.list_notes(_request()))
    assert listed["notes"][0]["sources"] == [
        {
            "url": "https://example.com/paper",
            "title": "Updated Source",
            "hostname": "example.com",
            "source_author": "Updated Author",
            "source_published_at": "2026-02-06T07:08:09+00:00",
            "attached_at": "2026-02-07T01:02:03+00:00",
        }
    ]


def test_notes_delete_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    response = asyncio.run(extension.delete_note(_request(), note_id))

    assert response["ok"] is True
    assert any(call[0] == "delete" and call[1] == "notes" for call in repo.calls)


def test_notes_create_sync_generates_id_when_missing(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePayload(title="No ID", note_body="Body", source_url="https://example.com/a", tags=[])

    response = asyncio.run(extension.create_note(_request(), payload))

    note_id = response["note_id"]
    assert isinstance(note_id, str)
    assert len(note_id) == 36


def test_notes_create_sync_accepts_comma_separated_tags(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePayload(
        id="2f3f2367-64f3-422d-b14d-cf70650fc4ca",
        title="Tags",
        note_body="Body",
        tags="43f2fbbf-2390-4ea3-bfc4-28ea0803aca7, 5ec57fbc-5662-47f5-8abf-4f95ce13fd77",
    )

    response = asyncio.run(extension.create_note(_request(), payload))

    assert response["ok"] is True
    join_calls = [call for call in repo.calls if call[0] == "rpc" and call[1] == "replace_note_tag_links_atomic"]
    assert len(join_calls) == 1
    assert len(join_calls[0][2]["json"]["p_tag_ids"]) == 2


def test_notes_create_sync_accepts_legacy_body_field(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePayload.model_validate(
        {
            "id": "2f3f2367-64f3-422d-b14d-cf70650fc4ca",
            "title": "Legacy",
            "body": "Body from legacy field",
            "tags": [],
        }
    )

    response = asyncio.run(extension.create_note(_request(), payload))

    assert response["ok"] is True
    note_post = [call for call in repo.calls if call[0] == "post" and call[1] == "notes"][0]
    assert note_post[2]["json"]["note_body"] == "Body from legacy field"


def test_notes_update_sync_supports_partial_patch_without_note_body(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = extension.ExtensionNotePatchRequest(id="2f3f2367-64f3-422d-b14d-cf70650fc4ca", title="Title only")

    response = asyncio.run(extension.update_note(_request(), payload))

    assert response["ok"] is True
    patch_call = [call for call in repo.calls if call[0] == "patch" and call[1] == "notes"][0]
    assert "note_body" not in patch_call[2]["json"]


def test_notes_list_sync(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    payload = asyncio.run(extension.list_notes(_request(), limit=999, offset=-4))
    assert payload["ok"] is True
    assert payload["total_count"] == 17
    assert len(payload["notes"]) == 1

    get_call = [call for call in repo.calls if call[0] == "get" and call[1] == "notes"][0]
    params = get_call[2]["params"]
    assert params["limit"] == "500"
    assert params["offset"] == "0"
    assert params["order"] == "created_at.desc"


def test_notes_archive_and_restore(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    archive_res = asyncio.run(extension.archive_note(_request(), note_id))
    restore_res = asyncio.run(extension.restore_note(_request(), note_id))

    assert archive_res["ok"] is True
    assert restore_res["ok"] is True
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)


def test_create_citation_from_note_links_note(monkeypatch):
    main = _build_app(monkeypatch)
    from app.routes import extension
    from app.services import research_entities

    repo = FakeSupabaseRepo()
    extension.supabase_repo = repo
    research_entities.supabase_repo = repo

    async def fake_account_type(_request, _user_id):
        return "standard"

    async def fake_create_citation(_user_id, _account_type, _citation_input):
        return "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"

    extension._get_account_type = fake_account_type
    extension.create_citation = fake_create_citation

    note_id = "2f3f2367-64f3-422d-b14d-cf70650fc4ca"
    response = asyncio.run(extension.create_citation_from_note(_request(), note_id))

    assert response["citation_id"] == "c2b7ff8e-50bb-4fb8-a377-c62f84fbcc88"
    assert any(call[0] == "patch" and call[1] == "notes" for call in repo.calls)
