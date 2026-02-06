alter table public.unlock_history
  add column if not exists success boolean,
  add column if not exists status integer,
  add column if not exists block_reason text,
  add column if not exists provider text,
  add column if not exists ray_id text;

update public.unlock_history
set success = true
where success is null;
