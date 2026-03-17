# Environment Checklist

## Required by environment

### `dev`

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### `staging`

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGINS`

### `prod`

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CORS_ORIGINS`
- `PADDLE_WEBHOOK_SECRET`

## Runtime settings

- `CANONICAL_APP_ORIGIN`
- `AUTH_HANDOFF_TTL_SECONDS`
- `EXTENSION_IDEMPOTENCY_TTL_SECONDS`
- `TRUSTED_PROXY_CIDRS`
- `ALLOW_PROXY_HEADERS`
- `SECURITY_HSTS_ENABLED`
- `RATE_LIMIT_ANONYMOUS_PUBLIC`
- `RATE_LIMIT_ANONYMOUS_PUBLIC_WINDOW_SECONDS`
- `RATE_LIMIT_AUTHENTICATED_READ`
- `RATE_LIMIT_AUTHENTICATED_READ_WINDOW_SECONDS`
- `RATE_LIMIT_AUTH_SENSITIVE`
- `RATE_LIMIT_AUTH_SENSITIVE_WINDOW_SECONDS`
- `RATE_LIMIT_FUTURE_WRITE_HEAVY`
- `RATE_LIMIT_FUTURE_WRITE_HEAVY_WINDOW_SECONDS`

## Origin and auth expectations

- `CORS_ORIGINS` must not contain `*` in staging or production.
- The authenticated web origin is expected to be `https://app.writior.com` unless explicitly overridden.
- Protected API routes require `Authorization: Bearer <token>`.
- Extension profiles must target canonical app origins, not legacy Render origins.
