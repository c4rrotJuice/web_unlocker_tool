alter table auth_handoff_codes
  add column if not exists refresh_token text,
  add column if not exists expires_in integer,
  add column if not exists token_type text;
