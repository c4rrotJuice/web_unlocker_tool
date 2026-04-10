create table if not exists auth_rate_limit_buckets (
  rate_scope text not null,
  identity_key text not null,
  window_start timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (rate_scope, identity_key)
);

create index if not exists auth_rate_limit_buckets_updated_idx
  on auth_rate_limit_buckets (updated_at);

create table if not exists revoked_auth_tokens (
  token_hash text primary key,
  user_id uuid,
  revoked_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists revoked_auth_tokens_expires_idx
  on revoked_auth_tokens (expires_at);

create or replace function public.hit_auth_rate_limit(
  p_scope text,
  p_identity text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => greatest(p_window_seconds, 1));
  v_record auth_rate_limit_buckets%rowtype;
begin
  if p_scope is null or btrim(p_scope) = '' or p_identity is null or btrim(p_identity) = '' then
    allowed := false;
    retry_after := greatest(p_window_seconds, 1);
    remaining := 0;
    return next;
    return;
  end if;

  insert into auth_rate_limit_buckets as buckets (
    rate_scope,
    identity_key,
    window_start,
    request_count,
    updated_at
  )
  values (
    p_scope,
    p_identity,
    v_now,
    1,
    v_now
  )
  on conflict (rate_scope, identity_key)
  do update set
    window_start = case
      when buckets.window_start <= v_now - v_window then v_now
      else buckets.window_start
    end,
    request_count = case
      when buckets.window_start <= v_now - v_window then 1
      else buckets.request_count + 1
    end,
    updated_at = v_now
  returning * into v_record;

  allowed := v_record.request_count <= greatest(p_limit, 1);
  remaining := greatest(greatest(p_limit, 1) - v_record.request_count, 0);
  retry_after := case
    when allowed then remaining
    else greatest(ceil(extract(epoch from (v_record.window_start + v_window - v_now)))::integer, 1)
  end;
  return next;
end;
$$;

grant execute on function public.hit_auth_rate_limit(text, text, integer, integer) to service_role;
