drop index if exists public.citation_instances_user_id_source_id_key;

alter table public.citation_instances
  drop constraint if exists citation_instances_user_id_source_id_key;

create index if not exists citation_instances_user_id_source_id_idx
  on public.citation_instances (user_id, source_id);
