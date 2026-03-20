begin;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  citation_id uuid references public.citation_instances(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  title text check (title is null or char_length(trim(title)) <= 200),
  highlight_text text,
  note_body text not null check (char_length(note_body) between 1 and 50000),
  source_url text,
  source_domain text,
  source_title text check (source_title is null or char_length(trim(source_title)) <= 400),
  source_author text check (source_author is null or char_length(trim(source_author)) <= 300),
  source_published_at timestamptz,
  status text not null default 'active' check (status in ('active', 'archived')),
  archived_at timestamptz,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notes_user_updated_at
  on public.notes(user_id, updated_at desc);

create index if not exists idx_notes_user_project_updated_at
  on public.notes(user_id, project_id, updated_at desc);

create index if not exists idx_notes_status_archived_at
  on public.notes(user_id, status, archived_at desc nulls last);

create index if not exists idx_notes_search_vector
  on public.notes using gin(search_vector);

create table if not exists public.note_sources (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid references public.sources(id) on delete cascade,
  citation_id uuid references public.citation_instances(id) on delete cascade,
  relation_type text not null default 'external'
    check (relation_type in ('external', 'source', 'citation')),
  url text,
  hostname text,
  title text,
  source_author text,
  source_published_at timestamptz,
  position integer not null default 0 check (position >= 0),
  attached_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint note_sources_reference_check check (
    (relation_type = 'external' and url is not null)
    or (relation_type = 'source' and source_id is not null)
    or (relation_type = 'citation' and citation_id is not null)
  )
);

create index if not exists idx_note_sources_note_attached_at
  on public.note_sources(note_id, attached_at desc);

create index if not exists idx_note_sources_note_position
  on public.note_sources(note_id, position asc, attached_at asc, id asc);

create index if not exists idx_note_sources_source_id
  on public.note_sources(source_id)
  where source_id is not null;

create index if not exists idx_note_sources_citation_id
  on public.note_sources(citation_id)
  where citation_id is not null;

create table if not exists public.note_links (
  note_id uuid not null references public.notes(id) on delete cascade,
  linked_note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, linked_note_id),
  constraint note_links_not_self check (note_id <> linked_note_id)
);

create index if not exists idx_note_links_linked_note_id
  on public.note_links(linked_note_id);

create table if not exists public.note_tag_links (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

create index if not exists idx_note_tag_links_tag_id
  on public.note_tag_links(tag_id);

commit;
