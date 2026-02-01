create table if not exists public.user_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_key text not null,
  awarded_at timestamptz not null default now(),
  metadata jsonb null,
  unique (user_id, milestone_key)
);

create index if not exists user_milestones_user_id_awarded_at_idx
  on public.user_milestones (user_id, awarded_at desc);

create index if not exists unlock_history_user_id_unlocked_at_idx
  on public.unlock_history (user_id, unlocked_at desc);

create index if not exists citations_user_id_cited_at_idx
  on public.citations (user_id, cited_at desc);

create or replace function public.get_unlock_days(p_user_id uuid)
returns table(day date)
language sql
stable
as $$
  select distinct (unlocked_at at time zone 'utc')::date as day
  from public.unlock_history
  where user_id = p_user_id
  order by day desc;
$$;

create or replace function public.get_monthly_domain_counts(p_user_id uuid, p_month date)
returns table(domain text, unlocks integer)
language sql
stable
as $$
  with month_window as (
    select p_month as month_start,
           (p_month + interval '1 month')::date as month_end
  ),
  filtered as (
    select lower(split_part(regexp_replace(url, '^https?://', ''), '/', 1)) as domain
    from public.unlock_history, month_window
    where user_id = p_user_id
      and unlocked_at >= month_window.month_start
      and unlocked_at < month_window.month_end
  )
  select domain, count(*)::int as unlocks
  from filtered
  where domain is not null and domain <> ''
  group by domain
  order by unlocks desc
  limit 5;
$$;

create or replace function public.get_monthly_citation_breakdown(p_user_id uuid, p_month date)
returns table(format text, citations integer)
language sql
stable
as $$
  with month_window as (
    select p_month as month_start,
           (p_month + interval '1 month')::date as month_end
  )
  select coalesce(format, 'unknown') as format,
         count(*)::int as citations
  from public.citations, month_window
  where user_id = p_user_id
    and cited_at >= month_window.month_start
    and cited_at < month_window.month_end
  group by format
  order by citations desc;
$$;
