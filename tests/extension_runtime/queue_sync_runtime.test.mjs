import test from "node:test";
import assert from "node:assert/strict";

import { installFakeIndexedDb } from "./helpers/fake_indexeddb.mjs";
import { createQueueManager } from "../../extension/background/queue_manager.js";
import { createSyncManager } from "../../extension/background/sync_manager.js";
import { putRecord, getRecord, listRecords } from "../../extension/storage/local_db.js";
import { getRemoteId, setRemoteId } from "../../extension/storage/reconciliation.js";

const fakeDb = installFakeIndexedDb();

async function seedLocalRecord(storeName, id, extra = {}) {
  await putRecord(storeName, {
    id,
    sync_status: "queued",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...extra,
  });
}

function createSessionManagerStub({ authorized = true } = {}) {
  return {
    authorized,
    async ensureSession() {
      if (!this.authorized) {
        const error = new Error("auth_required");
        error.status = 401;
        throw error;
      }
      return { access_token: "token" };
    },
  };
}

test.beforeEach(() => {
  fakeDb.reset();
});

test("network failure retries then reconciles successfully", async () => {
  const queueManager = createQueueManager();
  const sessionManager = createSessionManagerStub();
  let attempts = 0;
  const syncManager = createSyncManager({
    queueManager,
    sessionManager,
    apiClient: {
      async captureCitation() {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error("temporarily_unavailable");
          error.status = 503;
          throw error;
        }
        return { data: { id: "remote-citation-1" } };
      },
    },
  });

  await seedLocalRecord("citations", "citation_local_1", { url: "https://example.com" });
  const item = await queueManager.enqueue("capture_citation", { url: "https://example.com" }, { local_id: "citation_local_1" });

  await syncManager.flush();

  let localCitation = await getRecord("citations", "citation_local_1");
  assert.equal(localCitation.sync_status, "failed_retryable");
  let [queuedAfterFailure] = await listRecords("queue");
  assert.equal(queuedAfterFailure.id, item.id);
  assert.equal(queuedAfterFailure.status, "retry");
  assert.ok(queuedAfterFailure.next_attempt_at);

  await queueManager.mark(queuedAfterFailure, {
    status: "retry",
    next_attempt_at: new Date(Date.now() - 1_000).toISOString(),
  });

  await syncManager.flush();

  localCitation = await getRecord("citations", "citation_local_1");
  assert.equal(localCitation.sync_status, "synced");
  assert.equal(localCitation.remote_id, "remote-citation-1");
  assert.equal(await getRemoteId("citations", "citation_local_1"), "remote-citation-1");
  assert.deepEqual(await listRecords("queue"), []);
  assert.equal(attempts, 2);
});

test("401 auth expiry pauses replay and later resumes cleanly", async () => {
  const queueManager = createQueueManager();
  const sessionManager = createSessionManagerStub();
  let attempts = 0;
  const apiClient = {
    async captureCitation() {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("auth_required");
        error.status = 401;
        throw error;
      }
      return { data: { id: "remote-citation-2" } };
    },
  };
  const syncManager = createSyncManager({ queueManager, sessionManager, apiClient });

  await seedLocalRecord("citations", "citation_local_2", { url: "https://example.com/auth" });
  await queueManager.enqueue("capture_citation", { url: "https://example.com/auth" }, { local_id: "citation_local_2" });

  await syncManager.flush();

  let [queued] = await listRecords("queue");
  let localCitation = await getRecord("citations", "citation_local_2");
  assert.equal(queued.status, "auth_needed");
  assert.equal(localCitation.sync_status, "auth_needed");

  await syncManager.flush();

  queued = (await listRecords("queue"))[0];
  assert.equal(queued, undefined);
  localCitation = await getRecord("citations", "citation_local_2");
  assert.equal(localCitation.sync_status, "synced");
  assert.equal(localCitation.remote_id, "remote-citation-2");
});

test("persisted queue and reconciliation survive restart for dependent replay", async () => {
  await setRemoteId("citations", "citation_local_3", "remote-citation-3", { idempotency_key: "idem-citation-3" });
  await seedLocalRecord("quotes", "quote_local_3", {
    quote_text: "Queued quote",
    citation_local_id: "citation_local_3",
  });

  const initialQueueManager = createQueueManager();
  await initialQueueManager.enqueue(
    "capture_quote",
    { citation_local_id: "citation_local_3", quote_text: "Queued quote" },
    {
      local_id: "quote_local_3",
      depends_on: [{ kind: "citation", local_id: "citation_local_3" }],
      idempotency_key: "idem-quote-3",
    },
  );

  const restartedQueueManager = createQueueManager();
  const restartedSyncManager = createSyncManager({
    queueManager: restartedQueueManager,
    sessionManager: createSessionManagerStub(),
    apiClient: {
      async captureQuote(payload) {
        assert.equal(payload.citation_id, "remote-citation-3");
        return { data: { id: "remote-quote-3" } };
      },
    },
  });

  await restartedSyncManager.flush();

  const localQuote = await getRecord("quotes", "quote_local_3");
  assert.equal(localQuote.sync_status, "synced");
  assert.equal(localQuote.remote_id, "remote-quote-3");
  assert.equal(await getRemoteId("quotes", "quote_local_3"), "remote-quote-3");
});

test("dependency-gated replay unblocks quote before note in canonical order", async () => {
  const queueManager = createQueueManager();
  const syncManager = createSyncManager({
    queueManager,
    sessionManager: createSessionManagerStub(),
    apiClient: {
      async captureQuote(payload) {
        assert.equal(payload.citation_id, "remote-citation-4");
        return { data: { id: "remote-quote-4" } };
      },
      async captureNote(payload) {
        assert.equal(payload.citation_id, "remote-citation-4");
        assert.equal(payload.quote_id, "remote-quote-4");
        return { data: { id: "remote-note-4" } };
      },
    },
  });

  await seedLocalRecord("quotes", "quote_local_4", { quote_text: "Pending quote", citation_local_id: "citation_local_4" });
  await seedLocalRecord("notes", "note_local_4", { title: "Pending note" });
  await queueManager.enqueue("capture_quote", { citation_local_id: "citation_local_4", quote_text: "Pending quote" }, {
    local_id: "quote_local_4",
    depends_on: [{ kind: "citation", local_id: "citation_local_4" }],
  });
  await queueManager.enqueue("capture_note", { note: { id: "note_local_4", title: "Pending note" }, citation_local_id: "citation_local_4", quote_local_id: "quote_local_4" }, {
    local_id: "note_local_4",
    depends_on: [
      { kind: "citation", local_id: "citation_local_4" },
      { kind: "quote", local_id: "quote_local_4" },
    ],
  });

  assert.deepEqual(await queueManager.readyForReplay(), []);
  await setRemoteId("citations", "citation_local_4", "remote-citation-4", { idempotency_key: "idem-citation-4" });
  const readyAfterCitation = await queueManager.readyForReplay();
  assert.deepEqual(readyAfterCitation.map((item) => item.type), ["capture_quote"]);

  await syncManager.flush();
  assert.equal((await getRecord("quotes", "quote_local_4")).sync_status, "synced");
  const readyAfterQuote = await queueManager.readyForReplay();
  assert.deepEqual(readyAfterQuote.map((item) => item.type), ["capture_note"]);

  await syncManager.flush();
  assert.equal((await getRecord("notes", "note_local_4")).sync_status, "synced");
});

test("duplicate late success resolves idempotently without duplicate canonical creation", async () => {
  const queueManager = createQueueManager();
  const sessionManager = createSessionManagerStub();
  const remoteByIdempotency = new Map();
  let remoteCreates = 0;
  const syncManager = createSyncManager({
    queueManager,
    sessionManager,
    apiClient: {
      async captureCitation(_payload, { idempotencyKey }) {
        if (!remoteByIdempotency.has(idempotencyKey)) {
          remoteCreates += 1;
          remoteByIdempotency.set(idempotencyKey, `remote-citation-${remoteCreates}`);
          const error = new Error("gateway_timeout");
          error.status = 504;
          throw error;
        }
        return { data: { id: remoteByIdempotency.get(idempotencyKey) } };
      },
    },
  });

  await seedLocalRecord("citations", "citation_local_5", { url: "https://example.com/late-success" });
  await queueManager.enqueue("capture_citation", { url: "https://example.com/late-success" }, {
    local_id: "citation_local_5",
    idempotency_key: "idem-citation-5",
  });

  await syncManager.flush();
  const [queuedAfterTimeout] = await listRecords("queue");
  await queueManager.mark(queuedAfterTimeout, {
    status: "retry",
    next_attempt_at: new Date(Date.now() - 1_000).toISOString(),
  });
  await syncManager.flush();

  assert.equal(remoteCreates, 1);
  assert.equal(await getRemoteId("citations", "citation_local_5"), "remote-citation-1");
  assert.deepEqual(await listRecords("queue"), []);
});

test("usage events remain low-priority and never block core capture reconciliation", async () => {
  const queueManager = createQueueManager();
  const syncManager = createSyncManager({
    queueManager,
    sessionManager: createSessionManagerStub(),
    apiClient: {
      async captureCitation() {
        return { data: { id: "remote-citation-6" } };
      },
      async usageEvent() {
        const error = new Error("usage_endpoint_unavailable");
        error.status = 503;
        throw error;
      },
    },
  });

  await seedLocalRecord("citations", "citation_local_6", { url: "https://example.com/usage" });
  await queueManager.enqueue("usage_event", { event_type: "selection_capture" }, { priority: 90 });
  await queueManager.enqueue("capture_citation", { url: "https://example.com/usage" }, { local_id: "citation_local_6", priority: 10 });

  await syncManager.flush();

  const localCitation = await getRecord("citations", "citation_local_6");
  assert.equal(localCitation.sync_status, "synced");
  const remainingQueue = await listRecords("queue");
  assert.equal(remainingQueue.length, 1);
  assert.equal(remainingQueue[0].type, "usage_event");
  assert.equal(remainingQueue[0].status, "retry");
});
