begin;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  use_case text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system'
    check (theme in ('light', 'dark', 'system')),
  editor_density text not null default 'comfortable'
    check (editor_density in ('compact', 'comfortable', 'spacious')),
  default_citation_style text not null default 'apa'
    check (default_citation_style in ('apa', 'mla', 'chicago', 'harvard', 'custom')),
  sidebar_collapsed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free'
    check (tier in ('free', 'standard', 'pro', 'dev')),
  status text not null default 'active'
    check (status in ('active', 'grace_period', 'expired', 'canceled')),
  paid_until timestamptz,
  auto_renew boolean not null default false,
  source text not null default 'system'
    check (source in ('system', 'paddle', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  provider text not null default 'paddle' check (provider in ('paddle')),
  provider_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'paddle' check (provider in ('paddle')),
  provider_subscription_id text not null unique,
  provider_price_id text,
  tier text not null check (tier in ('standard', 'pro')),
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_handoff_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_path text,
  session_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint auth_handoff_codes_unused_or_used_once check (used_at is null or used_at >= created_at)
);

create index if not exists idx_auth_handoff_codes_user_id on public.auth_handoff_codes(user_id);
create index if not exists idx_auth_handoff_codes_expires_at on public.auth_handoff_codes(expires_at);

create or replace function public.bootstrap_new_user(p_user_id uuid, p_display_name text, p_use_case text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles(user_id, display_name, use_case)
  values (p_user_id, coalesce(nullif(trim(p_display_name), ''), 'User'), p_use_case)
  on conflict (user_id) do nothing;

  insert into public.user_preferences(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.user_entitlements(user_id, tier, status, source)
  values (p_user_id, 'free', 'active', 'system')
  on conflict (user_id) do nothing;
end;
$$;

create or replace view public.v_user_account_state as
select
  p.user_id,
  p.display_name,
  p.use_case,
  e.tier,
  e.status,
  e.paid_until,
  e.auto_renew,
  e.source as entitlement_source
from public.user_profiles p
join public.user_entitlements e on e.user_id = p.user_id;

commit;
