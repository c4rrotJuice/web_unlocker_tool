import { buildQueueItem } from "../shared/models.js";
import { deleteRecord, listRecords, putRecord } from "../storage/local_db.js";
import { getRemoteId } from "../storage/reconciliation.js";

function byPriority(left, right) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
}

async function canReplay(item) {
  if (item.type === "usage_event") return true;
  for (const dependency of item.depends_on || []) {
    if (dependency.kind === "citation" && !(await getRemoteId("citations", dependency.local_id))) return false;
    if (dependency.kind === "quote" && !(await getRemoteId("quotes", dependency.local_id))) return false;
  }
  return true;
}

async function notifyChange(onChange, detail) {
  if (typeof onChange === "function") {
    await onChange(detail);
  }
}

export function createQueueManager({ onChange } = {}) {
  return {
    async enqueue(type, payload, options = {}) {
      const item = buildQueueItem(type, payload, options);
      await putRecord("queue", item);
      await notifyChange(onChange, { op: "enqueue", item });
      return item;
    },
    async list() {
      const items = await listRecords("queue");
      return items.sort(byPriority);
    },
    async readyForReplay() {
      const items = await this.list();
      const ready = [];
      for (const item of items) {
        if (item.status === "synced" || item.status === "blocked") continue;
        if (item.next_attempt_at && new Date(item.next_attempt_at).getTime() > Date.now()) continue;
        if (await canReplay(item)) ready.push(item);
      }
      return ready.sort(byPriority);
    },
    async getNextReplayAt() {
      const items = await this.list();
      let nextAttemptAt = null;
      for (const item of items) {
        if (item.status === "synced" || item.status === "failed") continue;
        if (item.status === "auth_needed") continue;
        const replayable = await canReplay(item);
        if (replayable && (!item.next_attempt_at || new Date(item.next_attempt_at).getTime() <= Date.now())) {
          return new Date().toISOString();
        }
        if (!item.next_attempt_at) continue;
        const next = new Date(item.next_attempt_at).getTime();
        if (!Number.isFinite(next)) continue;
        if (nextAttemptAt === null || next < nextAttemptAt) {
          nextAttemptAt = next;
        }
      }
      return nextAttemptAt ? new Date(nextAttemptAt).toISOString() : null;
    },
    async mark(item, patch) {
      const next = {
        ...item,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      await putRecord("queue", next);
      await notifyChange(onChange, { op: "mark", item: next });
      return next;
    },
    async remove(id) {
      await deleteRecord("queue", id);
      await notifyChange(onChange, { op: "remove", id });
    },
  };
}
