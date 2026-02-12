# Deploy Checklist

## 1) Backend environment selection

- [ ] Set `ENV` to one of: `dev`, `staging`, `prod`.
- [ ] Confirm startup validation passes (app fails fast if required variables are missing).

## 2) Required environment variables

### dev
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

### staging
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `WEB_UNLOCKER_SUPABASE_URL`
- [ ] `WEB_UNLOCKER_SUPABASE_ANON_KEY`
- [ ] `CORS_ORIGINS`

### prod
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `WEB_UNLOCKER_SUPABASE_URL`
- [ ] `WEB_UNLOCKER_SUPABASE_ANON_KEY`
- [ ] `CORS_ORIGINS`
- [ ] `PADDLE_WEBHOOK_SECRET`

## 3) Extension profile build

- [ ] Choose one build switch:
  - `EXTENSION_BUILD_PROFILE=staging`, or
  - `EXTENSION_BUILD_PROFILE=prod`
- [ ] Generate extension config + manifest:

```bash
EXTENSION_BUILD_PROFILE=staging python extension/scripts/build_profile.py
# or
EXTENSION_BUILD_PROFILE=prod python extension/scripts/build_profile.py
```

- [ ] Verify generated files:
  - `extension/config.js`
  - `extension/manifest.json`

## 4) Post-deploy sanity checks

- [ ] Backend health check responds.
- [ ] Auth flow works (login/signup + token exchange).
- [ ] Extension can call backend API successfully.
- [ ] CORS allows expected frontend origins and rejects unknown origins.
- [ ] Paddle webhook endpoint validates signatures in target environment.
