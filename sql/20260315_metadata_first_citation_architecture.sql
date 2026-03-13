alter table public.citations
  add column if not exists source_fingerprint text null,
  add column if not exists source_version text null,
  add column if not exists render_cache jsonb not null default '[]'::jsonb;

create index if not exists citations_user_id_source_fingerprint_idx
  on public.citations (user_id, source_fingerprint);

create index if not exists citations_user_id_source_version_idx
  on public.citations (user_id, source_version);
