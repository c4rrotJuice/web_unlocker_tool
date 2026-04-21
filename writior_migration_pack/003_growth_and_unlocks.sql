begin;

create table if not exists public.unlock_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  anon_fingerprint text,
  url text not null,
  domain text not null,
  source text not null check (source in ('web', 'extension')),
  event_type text not null default 'unlock' check (event_type in ('unlock', 'copy_assist', 'selection_capture')),
  event_id uuid,
  was_cleaned boolean not null default true,
  created_at timestamptz not null default now(),
  constraint unlock_events_user_or_anon_required check (user_id is not null or anon_fingerprint is not null)
);

create unique index if not exists uq_unlock_events_user_event
  on public.unlock_events(user_id, event_id)
  where user_id is not null and event_id is not null;

create index if not exists idx_unlock_events_user_created_at
  on public.unlock_events(user_id, created_at desc);

create index if not exists idx_unlock_events_domain_created_at
  on public.unlock_events(domain, created_at desc);

create table if not exists public.guest_unlock_usage (
  id uuid primary key default gen_random_uuid(),
  usage_key text not null,
  usage_date date not null,
  usage_count integer not null default 1 check (usage_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usage_key, usage_date)
);

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  domain text not null,
  title text,
  saved_from text not null default 'web' check (saved_from in ('web', 'extension')),
  created_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists idx_bookmarks_user_created_at
  on public.bookmarks(user_id, created_at desc);

create table if not exists public.user_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_key text not null,
  awarded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, milestone_key)
);

create index if not exists idx_user_milestones_user_awarded_at
  on public.user_milestones(user_id, awarded_at desc);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('unlock', 'source_captured', 'citation_created', 'quote_saved', 'note_created', 'document_updated')),
  entity_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists idx_activity_events_user_created_at
  on public.activity_events(user_id, created_at desc);

create index if not exists idx_activity_events_user_type
  on public.activity_events(user_id, event_type, created_at desc);

create table if not exists public.user_daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  activity_score integer not null default 0 check (activity_score >= 0),
  actions_count integer not null default 0 check (actions_count >= 0),
  last_event_at timestamptz not null default now(),
  primary key (user_id, date)
);

create index if not exists idx_user_daily_activity_user_date
  on public.user_daily_activity(user_id, date desc);

create table if not exists public.user_activity_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_active_date date,
  updated_at timestamptz not null default now()
);

create or replace function public.get_unlock_days(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
returns table(unlock_day date)
language sql
security definer
set search_path = public
as $$
  select distinct date(ue.created_at) as unlock_day
  from public.unlock_events ue
  where ue.user_id = p_user_id
    and date(ue.created_at) between p_start_date and p_end_date
  order by unlock_day;
$$;

create or replace function public.get_monthly_domain_counts(
  p_user_id uuid,
  p_month_start date,
  p_month_end date
)
returns table(domain text, unlock_count bigint)
language sql
security definer
set search_path = public
as $$
  select ue.domain, count(*)::bigint as unlock_count
  from public.unlock_events ue
  where ue.user_id = p_user_id
    and date(ue.created_at) between p_month_start and p_month_end
  group by ue.domain
  order by unlock_count desc, ue.domain asc;
$$;

commit;
