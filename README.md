# Web Unlocker Tool

## Extension → Web App Auth Handoff

When the extension user clicks **Work in Editor**, the extension requests a short-lived handoff code from the backend and then opens the web app handoff page:

1. **Create code**: `POST /api/auth/handoff` with the Supabase access token in the `Authorization` header and an optional `redirect_path`.
2. **Open handoff**: the extension opens `/auth/handoff?code=...` on the web app host.
3. **Exchange**: the web app calls `POST /api/auth/handoff/exchange` to validate the one-time code, sets the `access_token` cookie, and redirects to the editor.

### Security rationale

- **No tokens in URLs**: access/refresh tokens never appear in query strings or referrers.
- **Short-lived + one-time**: handoff codes expire after ~60 seconds and are marked used on exchange.
- **Server-side validation**: the backend binds the code to the authenticated user and rate limits creation attempts.
