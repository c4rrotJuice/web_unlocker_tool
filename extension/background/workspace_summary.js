import { listRecords } from "../storage/local_db.js";

function sortByUpdatedAt(records) {
  return [...records].sort((a, b) => {
    const left = new Date(b.updated_at || b.created_at || 0).getTime();
    const right = new Date(a.updated_at || a.created_at || 0).getTime();
    return left - right;
  });
}

export function createWorkspaceSummary() {
  return {
    async getSummary() {
      const [captures, notes, quotes, citations, activity, queue] = await Promise.all([
        listRecords("captures"),
        listRecords("notes"),
        listRecords("quotes"),
        listRecords("citations"),
        listRecords("activity"),
        listRecords("queue"),
      ]);
      return {
        drafts: sortByUpdatedAt(captures || []).slice(0, 10).map((draft) => ({
          id: draft.id,
          type: draft.type || "draft",
          title: draft.payload?.title || draft.payload?.metadata?.title || "Untitled draft",
          url: draft.payload?.url || draft.payload?.metadata?.canonical_url || draft.payload?.metadata?.url || "",
          summary: draft.payload?.selected_text || draft.payload?.metadata?.title || "",
          updated_at: draft.updated_at || draft.created_at || null,
        })),
        notes: sortByUpdatedAt(notes).slice(0, 10).map((note) => ({
          id: note.id,
          title: note.title || "Untitled note",
          preview: note.note_body ? String(note.note_body).slice(0, 160) : "",
          sync_status: note.sync_status || "local",
          updated_at: note.updated_at || note.created_at || null,
        })),
        citations: sortByUpdatedAt(citations).slice(0, 10).map((citation) => ({
          id: citation.id,
          title: citation.metadata?.title || citation.url || "Captured source",
          quote: citation.quote || citation.excerpt || "",
          sync_status: citation.sync_status || "local",
          updated_at: citation.updated_at || citation.created_at || null,
        })),
        quotes: sortByUpdatedAt(quotes).slice(0, 10).map((quote) => ({
          id: quote.id,
          text: quote.quote_text ? String(quote.quote_text).slice(0, 160) : "",
          citation_local_id: quote.citation_local_id || null,
          sync_status: quote.sync_status || "local",
          last_error: quote.last_error || null,
          updated_at: quote.updated_at || quote.created_at || null,
        })),
        activity: sortByUpdatedAt(activity).slice(0, 10),
        queue_items: sortByUpdatedAt(queue).slice(0, 10).map((item) => ({
          id: item.id,
          type: item.type,
          local_id: item.local_id || null,
          status: item.status || "pending",
          last_error: item.last_error || null,
          next_attempt_at: item.next_attempt_at || null,
          dependency_count: Array.isArray(item.depends_on) ? item.depends_on.length : 0,
          updated_at: item.updated_at || item.created_at || null,
        })),
        queue: {
          pending: queue.filter((item) => item.status === "pending" || item.status === "retry").length,
          failed: queue.filter((item) => item.status === "failed").length,
          auth_needed: queue.some((item) => item.status === "auth_needed"),
        },
      };
    },
  };
}
