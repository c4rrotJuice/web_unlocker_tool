# Web Unlocker Tool

## Extension → Web App Auth Handoff

When the extension user clicks **Work in Editor**, the extension requests a short-lived handoff code from the backend and then opens the web app handoff page:

1. **Create code**: `POST /api/auth/handoff` with the Supabase access token in the `Authorization` header and an optional `redirect_path`.
2. **Open handoff**: the extension opens `/auth/handoff?code=...` on the web app host.
3. **Exchange**: the web app calls `POST /api/auth/handoff/exchange` to validate the one-time code, applies the returned Supabase session via `supabase.auth.setSession`, and redirects to the editor.

### Security rationale

- **No tokens in URLs**: access/refresh tokens never appear in query strings or referrers.
- **Short-lived + one-time**: handoff codes expire after ~60 seconds and are marked used on exchange.
- **Server-side validation**: the backend binds the code to the authenticated user and rate limits creation attempts.


## Extension Usage Event Sync

The extension now records unlock usage to the same `unlock_history` stream used by web unlock flows.

- Endpoint: `POST /api/extension/usage-event`
- Auth: `Authorization: Bearer <supabase_access_token>`
- Rate limit: 30 events/minute/user
- Idempotency: pass `event_id` UUID; duplicates are ignored server-side via `(user_id, event_id)` unique index.

### Request example

```json
{
  "url": "https://example.com/article",
  "event_id": "a5d54e8d-3eff-4a93-ae21-d74f0ebf8b7f"
}
```

### Response example

```json
{
  "ok": true,
  "deduped": false
}
```

If `deduped` is `true`, the event was already processed previously.
