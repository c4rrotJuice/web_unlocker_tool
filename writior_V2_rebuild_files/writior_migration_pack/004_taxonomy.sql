begin;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  color text,
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  icon text check (icon is null or char_length(trim(icon)) <= 32),
  last_opened_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_projects_user_name_ci
  on public.projects(user_id, lower(name));

create index if not exists idx_projects_user_status_updated
  on public.projects(user_id, status, updated_at desc);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_tags_user_name_ci
  on public.tags(user_id, lower(name));

commit;
