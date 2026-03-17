begin;

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paddle' check (provider in ('paddle')),
  event_id text not null unique,
  event_type text not null,
  occurred_at timestamptz,
  processed_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_webhook_events_created_at
  on public.billing_webhook_events(created_at desc);

create index if not exists idx_billing_webhook_events_processed_at
  on public.billing_webhook_events(processed_at);

alter table public.billing_webhook_events enable row level security;

drop policy if exists "billing_webhook_events_service_role_only" on public.billing_webhook_events;
create policy "billing_webhook_events_service_role_only" on public.billing_webhook_events
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

commit;
