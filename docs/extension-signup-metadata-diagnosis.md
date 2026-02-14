# Extension signup metadata diagnosis

## What the code currently does

1. The extension performs `supabaseClient.auth.signUp(...)` first and sends profile fields as auth metadata (`options.data`).
2. Immediately after that, it calls backend `POST /api/signup` to "sync" metadata into `user_meta`.
3. Backend `/api/signup` only writes `name/use_case` into `public.user_meta`; it does **not** update auth `user_metadata`.
4. If `user_id` is missing in the extension payload, backend `/api/signup` runs another `supabase.auth.sign_up(...)` (without metadata) before writing `user_meta`.

## Why users can be authenticated but still see missing metadata

- Authentication success comes from the first step (extension-side `auth.signUp`).
- The metadata users often check in Supabase Auth (`auth.users.raw_user_meta_data`) is not guaranteed by backend `/api/signup`, because that route only upserts `public.user_meta`.
- In the fallback branch where `user_id` is absent, the backend creates/targets an auth user without passing `name/use_case` metadata, which can also leave auth metadata empty.

## Practical implication

This creates a split-brain behavior:

- `public.user_meta` can be present (or eventually present),
- auth account creation can succeed,
- but auth `user_metadata` may still be empty or inconsistent.

## Recommended fix direction

- Make extension signup a single source of truth: create auth user once, then only upsert `public.user_meta`.
- In backend `/api/signup`, stop creating a second auth user when `user_id` is missing; instead require `user_id` for extension sync or explicitly update auth metadata by user id.
- If auth metadata is required by product logic, add an explicit admin update call for `user_metadata` and cover with tests.
