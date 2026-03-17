import { getRecord, putRecord } from "./local_db.js";

const META_ID = "entity_mappings";

async function readMappingState() {
  return (await getRecord("sync_meta", META_ID)) || {
    id: META_ID,
    citations: {},
    quotes: {},
    notes: {},
    idempotency: {
      citations: {},
      quotes: {},
      notes: {},
    },
  };
}

function normalizeEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { remote_id: entry, reconciled_at: null, idempotency_key: null };
  }
  return {
    remote_id: entry.remote_id || null,
    reconciled_at: entry.reconciled_at || null,
    idempotency_key: entry.idempotency_key || null,
  };
}

export async function setRemoteId(kind, localId, remoteId, meta = {}) {
  const state = await readMappingState();
  state[kind] = state[kind] || {};
  state.idempotency = state.idempotency || {};
  state.idempotency[kind] = state.idempotency[kind] || {};
  state[kind][localId] = {
    remote_id: remoteId || null,
    reconciled_at: meta.reconciled_at || new Date().toISOString(),
    idempotency_key: meta.idempotency_key || null,
  };
  if (meta.idempotency_key && remoteId) {
    state.idempotency[kind][meta.idempotency_key] = remoteId;
  }
  await putRecord("sync_meta", state);
}

export async function getRemoteId(kind, localId) {
  const state = await readMappingState();
  return normalizeEntry(state?.[kind]?.[localId])?.remote_id || null;
}

export async function getRemoteIdByIdempotency(kind, idempotencyKey) {
  if (!idempotencyKey) return null;
  const state = await readMappingState();
  return state?.idempotency?.[kind]?.[idempotencyKey] || null;
}
