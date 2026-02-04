create table if not exists auth_handoff_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  user_id uuid not null,
  redirect_path text,
  access_token text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_handoff_codes_code_idx on auth_handoff_codes (code);
create index if not exists auth_handoff_codes_expires_idx on auth_handoff_codes (expires_at);
