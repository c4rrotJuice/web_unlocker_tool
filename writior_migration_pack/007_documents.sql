begin;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'Untitled' check (char_length(trim(title)) between 1 and 200),
  content_delta jsonb not null default '{"ops":[{"insert":"\\n"}]}'::jsonb,
  content_html text,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  archived_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documents_user_updated_at
  on public.documents(user_id, updated_at desc);

create index if not exists idx_documents_user_project_updated_at
  on public.documents(user_id, project_id, updated_at desc);

create index if not exists idx_documents_user_status_updated_at
  on public.documents(user_id, status, updated_at desc);

create table if not exists public.document_checkpoints (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  content_delta jsonb not null,
  content_html text,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_checkpoints_document_created_at
  on public.document_checkpoints(document_id, created_at desc);

create table if not exists public.document_citations (
  document_id uuid not null references public.documents(id) on delete cascade,
  citation_id uuid not null references public.citation_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (document_id, citation_id)
);

create index if not exists idx_document_citations_citation_id
  on public.document_citations(citation_id);

create table if not exists public.document_notes (
  document_id uuid not null references public.documents(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (document_id, note_id)
);

create index if not exists idx_document_notes_note_id
  on public.document_notes(note_id);

create table if not exists public.document_tags (
  document_id uuid not null references public.documents(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, tag_id)
);

create index if not exists idx_document_tags_tag_id
  on public.document_tags(tag_id);

commit;
