alter table public.citation_instances
  drop column if exists document_id;

alter table public.note_sources
  alter column url drop not null,
  add column if not exists source_id uuid null references public.sources(id) on delete set null,
  add column if not exists citation_id uuid null references public.citation_instances(id) on delete set null,
  add column if not exists relation_type text not null default 'external',
  add column if not exists position integer not null default 0;

create index if not exists note_sources_user_id_source_id_idx
  on public.note_sources (user_id, source_id)
  where source_id is not null;

create index if not exists note_sources_user_id_citation_id_idx
  on public.note_sources (user_id, citation_id)
  where citation_id is not null;
