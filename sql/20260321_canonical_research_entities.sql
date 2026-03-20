create extension if not exists pgcrypto;

-- Canonical projects
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'note_projects'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_note_projects'
  ) then
    alter table public.note_projects rename to legacy_note_projects;
  end if;
end
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  description text,
  status text not null default 'active',
  icon text,
  last_opened_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_len check (char_length(trim(name)) between 1 and 120),
  constraint projects_status_check check (status in ('active', 'archived')),
  constraint projects_icon_len_check check (icon is null or char_length(trim(icon)) <= 32)
);

create unique index if not exists projects_user_id_name_key
  on public.projects (user_id, lower(name));

create unique index if not exists projects_id_user_id_key
  on public.projects (id, user_id);

create index if not exists projects_user_id_status_updated_at_idx
  on public.projects (user_id, status, updated_at desc);

create index if not exists projects_user_id_last_opened_at_idx
  on public.projects (user_id, last_opened_at desc nulls last);

create index if not exists projects_user_id_archived_at_idx
  on public.projects (user_id, archived_at desc)
  where archived_at is not null;

insert into public.projects (
  id,
  user_id,
  name,
  color,
  description,
  status,
  icon,
  last_opened_at,
  archived_at,
  created_at,
  updated_at
)
select
  id,
  user_id,
  name,
  color,
  null,
  coalesce(status, case when archived_at is null then 'active' else 'archived' end, 'active'),
  icon,
  last_opened_at,
  archived_at,
  created_at,
  updated_at
from public.legacy_note_projects
on conflict (id) do update
set
  user_id = excluded.user_id,
  name = excluded.name,
  color = excluded.color,
  status = excluded.status,
  icon = excluded.icon,
  last_opened_at = excluded.last_opened_at,
  archived_at = excluded.archived_at,
  updated_at = excluded.updated_at;

drop view if exists public.note_projects;
create view public.note_projects as
select
  id,
  user_id,
  name,
  color,
  description,
  status,
  icon,
  last_opened_at,
  archived_at,
  created_at,
  updated_at
from public.projects;

-- Canonical tags and note_tags join
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'note_tags'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_note_tag_entities'
  ) then
    alter table public.note_tags rename to legacy_note_tag_entities;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'note_note_tags'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_note_note_tags'
  ) then
    alter table public.note_note_tags rename to legacy_note_note_tags;
  end if;
end
$$;

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_name_len check (char_length(trim(name)) between 1 and 80)
);

create unique index if not exists tags_user_id_name_key
  on public.tags (user_id, lower(name));

create unique index if not exists tags_id_user_id_key
  on public.tags (id, user_id);

create index if not exists tags_user_id_updated_at_idx
  on public.tags (user_id, updated_at desc);

insert into public.tags (id, user_id, name, created_at, updated_at)
select
  id,
  user_id,
  name,
  created_at,
  updated_at
from public.legacy_note_tag_entities
on conflict (id) do update
set
  user_id = excluded.user_id,
  name = excluded.name,
  updated_at = excluded.updated_at;

create table if not exists public.note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

create index if not exists note_tags_user_id_tag_id_idx
  on public.note_tags (user_id, tag_id);

create index if not exists note_tags_user_id_note_id_idx
  on public.note_tags (user_id, note_id);

insert into public.note_tags (note_id, tag_id, user_id, created_at)
select
  note_id,
  tag_id,
  user_id,
  created_at
from public.legacy_note_note_tags
on conflict (note_id, tag_id) do nothing;

drop view if exists public.note_note_tags;
create view public.note_note_tags as
select note_id, tag_id, user_id, created_at
from public.note_tags;

drop view if exists public.note_tags_legacy;
create view public.note_tags_legacy as
select id, user_id, name, created_at, updated_at
from public.tags;

-- Documents and document relationships
alter table public.documents
  add column if not exists project_id uuid null,
  add column if not exists content_html text null;

create table if not exists public.document_tags (
  document_id uuid not null references public.documents(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, tag_id)
);

create index if not exists document_tags_user_id_document_id_idx
  on public.document_tags (user_id, document_id);

create index if not exists document_tags_user_id_tag_id_idx
  on public.document_tags (user_id, tag_id);

create table if not exists public.document_citations (
  document_id uuid not null references public.documents(id) on delete cascade,
  citation_id uuid not null references public.citation_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (document_id, citation_id)
);

create index if not exists document_citations_user_id_document_id_attached_at_idx
  on public.document_citations (user_id, document_id, attached_at desc);

create index if not exists document_citations_user_id_citation_id_idx
  on public.document_citations (user_id, citation_id);

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_project_id_fkey'
  ) then
    alter table public.documents drop constraint documents_project_id_fkey;
  end if;
end
$$;

alter table public.documents
  add constraint documents_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

-- Notes: canonical project + quote links
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  citation_id uuid not null references public.citation_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  excerpt text not null,
  locator jsonb not null default '{}'::jsonb,
  annotation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_excerpt_len check (char_length(trim(excerpt)) between 12 and 50000)
);

create index if not exists quotes_user_id_created_at_idx
  on public.quotes (user_id, created_at desc);

create unique index if not exists quotes_citation_id_excerpt_locator_key
  on public.quotes (citation_id, md5(excerpt), md5(locator::text));

insert into public.quotes (citation_id, user_id, excerpt, locator, annotation, created_at, updated_at)
select distinct
  ci.id,
  ci.user_id,
  trim(ci.quote_text),
  coalesce(ci.locator, '{}'::jsonb),
  nullif(ci.annotation, ''),
  ci.created_at,
  ci.updated_at
from public.citation_instances ci
where ci.quote_text is not null
  and char_length(trim(ci.quote_text)) >= 12
  and trim(ci.quote_text) !~* '^(https?://|doi:|www\\.|untitled|title:|author:|date:|publisher:)'
  and trim(ci.quote_text) <> coalesce(trim(ci.excerpt), '')
on conflict do nothing;

alter table public.notes
  add column if not exists quote_id uuid null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass
      and conname = 'notes_project_id_fkey'
  ) then
    alter table public.notes drop constraint notes_project_id_fkey;
  end if;
end
$$;

alter table public.notes
  add constraint notes_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notes'::regclass
      and conname = 'notes_quote_id_fkey'
  ) then
    alter table public.notes
      add constraint notes_quote_id_fkey
      foreign key (quote_id) references public.quotes(id) on delete set null;
  end if;
end
$$;

create index if not exists notes_user_id_quote_id_idx
  on public.notes (user_id, quote_id)
  where quote_id is not null;

-- Canonical RLS
alter table public.projects enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;
alter table public.document_tags enable row level security;
alter table public.document_citations enable row level security;
alter table public.quotes enable row level security;

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
on public.projects
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
on public.projects
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
on public.projects
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
on public.projects
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "tags_select_own" on public.tags;
create policy "tags_select_own"
on public.tags
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "tags_insert_own" on public.tags;
create policy "tags_insert_own"
on public.tags
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "tags_update_own" on public.tags;
create policy "tags_update_own"
on public.tags
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "tags_delete_own" on public.tags;
create policy "tags_delete_own"
on public.tags
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "note_tags_select_own" on public.note_tags;
create policy "note_tags_select_own"
on public.note_tags
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "note_tags_insert_own" on public.note_tags;
create policy "note_tags_insert_own"
on public.note_tags
for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.notes n
    where n.id = note_tags.note_id and n.user_id = note_tags.user_id
  )
  and exists (
    select 1 from public.tags t
    where t.id = note_tags.tag_id and t.user_id = note_tags.user_id
  )
);

drop policy if exists "note_tags_delete_own" on public.note_tags;
create policy "note_tags_delete_own"
on public.note_tags
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "document_tags_select_own" on public.document_tags;
create policy "document_tags_select_own"
on public.document_tags
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "document_tags_insert_own" on public.document_tags;
create policy "document_tags_insert_own"
on public.document_tags
for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.documents d
    where d.id = document_tags.document_id and d.user_id = document_tags.user_id
  )
  and exists (
    select 1 from public.tags t
    where t.id = document_tags.tag_id and t.user_id = document_tags.user_id
  )
);

drop policy if exists "document_tags_delete_own" on public.document_tags;
create policy "document_tags_delete_own"
on public.document_tags
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "document_citations_select_own" on public.document_citations;
create policy "document_citations_select_own"
on public.document_citations
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "document_citations_insert_own" on public.document_citations;
create policy "document_citations_insert_own"
on public.document_citations
for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.documents d
    where d.id = document_citations.document_id and d.user_id = document_citations.user_id
  )
  and exists (
    select 1 from public.citation_instances ci
    where ci.id = document_citations.citation_id and ci.user_id = document_citations.user_id
  )
);

drop policy if exists "document_citations_delete_own" on public.document_citations;
create policy "document_citations_delete_own"
on public.document_citations
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "quotes_select_own" on public.quotes;
create policy "quotes_select_own"
on public.quotes
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "quotes_insert_own" on public.quotes;
create policy "quotes_insert_own"
on public.quotes
for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.citation_instances ci
    where ci.id = quotes.citation_id and ci.user_id = quotes.user_id
  )
);

drop policy if exists "quotes_update_own" on public.quotes;
create policy "quotes_update_own"
on public.quotes
for update to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.citation_instances ci
    where ci.id = quotes.citation_id and ci.user_id = quotes.user_id
  )
);

drop policy if exists "quotes_delete_own" on public.quotes;
create policy "quotes_delete_own"
on public.quotes
for delete to authenticated
using (auth.uid() = user_id);
