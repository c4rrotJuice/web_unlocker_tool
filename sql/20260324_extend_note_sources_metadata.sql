alter table public.note_sources
  add column if not exists source_author text,
  add column if not exists source_published_at timestamptz;

