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

create index if not exists document_citations_user_id_attached_at_idx
  on public.document_citations (user_id, attached_at desc);

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
returns table(style text, citation_count bigint)
language sql
stable
as $$
  with month_window as (
    select p_month as month_start,
           (p_month + interval '1 month')::date as month_end
  )
  select cr.style,
         count(distinct dc.citation_id)::bigint as citation_count
  from public.document_citations dc
  join public.citation_instances ci
    on ci.id = dc.citation_id
  join public.citation_renders cr
    on cr.citation_instance_id = ci.id, month_window
  where dc.user_id = p_user_id
    and dc.attached_at >= month_window.month_start
    and dc.attached_at < month_window.month_end
    and ci.user_id = p_user_id
  group by cr.style
  order by citation_count desc, cr.style asc;
$$;
