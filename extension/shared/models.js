export function createLocalId(prefix) {
  const token = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
  return `${prefix}_${token}`;
}

export function createIdempotencyKey(prefix) {
  return createLocalId(prefix);
}

export function normalizeMetadata(metadata = {}) {
  const normalized = { ...metadata };
  normalized.title = metadata.title ? String(metadata.title) : "";
  normalized.url = metadata.url ? String(metadata.url) : "";
  normalized.canonical_url = metadata.canonical_url ? String(metadata.canonical_url) : "";
  normalized.author = metadata.author ? String(metadata.author) : "";
  normalized.published_at = metadata.published_at ? String(metadata.published_at) : "";
  normalized.hostname = metadata.hostname ? String(metadata.hostname) : "";
  return normalized;
}

export function buildQueueItem(type, payload, options = {}) {
  return {
    id: options.id || createLocalId("queue"),
    type,
    payload,
    local_id: options.local_id || null,
    depends_on: Array.isArray(options.depends_on) ? [...options.depends_on] : [],
    idempotency_key: options.idempotency_key || createIdempotencyKey(type),
    status: options.status || "pending",
    priority: Number.isFinite(options.priority) ? options.priority : 10,
    attempt_count: Number.isFinite(options.attempt_count) ? options.attempt_count : 0,
    last_error: options.last_error || null,
    next_attempt_at: options.next_attempt_at || null,
    created_at: options.created_at || new Date().toISOString(),
    updated_at: options.updated_at || new Date().toISOString(),
  };
}

export function summarizeSession(session) {
  return {
    is_authenticated: Boolean(session?.access_token),
    user_id: session?.user?.id || null,
    email: session?.user?.email || null,
    expires_at: session?.expires_at || null,
  };
}

