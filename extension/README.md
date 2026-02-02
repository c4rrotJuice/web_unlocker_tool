# Web Unlocker Extension

## Configuration

This extension reads configuration from `extension/config.js`.

1) Open `extension/config.js`.
2) Set the following values:
   - `BACKEND_BASE_URL` (example: `https://web-unlocker-tool.onrender.com`)
   - `SUPABASE_URL` (example: `https://<project>.supabase.co`)
   - `SUPABASE_ANON_KEY` (your Supabase anon public key)
3) Ensure `manifest.json` includes host permissions for the backend and Supabase URLs you configured.

> Note: Do **not** use the Supabase service role key in the extension.
