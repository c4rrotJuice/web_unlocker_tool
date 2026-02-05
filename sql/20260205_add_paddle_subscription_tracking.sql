alter table if exists public.user_meta
  add column if not exists paddle_customer_id text,
  add column if not exists paddle_subscription_id text,
  add column if not exists paddle_price_id text,
  add column if not exists paid_until timestamptz,
  add column if not exists auto_renew boolean default false;

create index if not exists user_meta_paddle_customer_id_idx
  on public.user_meta (paddle_customer_id);

create index if not exists user_meta_paddle_subscription_id_idx
  on public.user_meta (paddle_subscription_id);
