create table if not exists auth_handoff_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text unique not null,
  attempt_secret_hash text not null,
  status text not null default 'pending',
  redirect_path text,
  user_id uuid,
  handoff_code text unique,
  expires_at timestamptz not null,
  ready_at timestamptz,
  exchanged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_handoff_attempts_status_check check (status in ('pending', 'ready', 'exchanged'))
);

create index if not exists auth_handoff_attempts_attempt_idx on auth_handoff_attempts (attempt_id);
create index if not exists auth_handoff_attempts_expires_idx on auth_handoff_attempts (expires_at);
create index if not exists auth_handoff_attempts_handoff_code_idx on auth_handoff_attempts (handoff_code);
