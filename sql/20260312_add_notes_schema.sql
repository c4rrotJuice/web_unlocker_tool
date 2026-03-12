-- Notes system schema for extension local-first sync
-- Supports: notes, projects, tags, note_tag join table

create table if not exists public.note_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_projects_name_len check (char_length(trim(name)) between 1 and 120)
);

create unique index if not exists note_projects_user_id_name_key
  on public.note_projects (user_id, lower(name));

create index if not exists note_projects_user_id_updated_at_idx
  on public.note_projects (user_id, updated_at desc);

create table if not exists public.note_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_tags_name_len check (char_length(trim(name)) between 1 and 80)
);

create unique index if not exists note_tags_user_id_name_key
  on public.note_tags (user_id, lower(name));

create index if not exists note_tags_user_id_updated_at_idx
  on public.note_tags (user_id, updated_at desc);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  highlight_text text,
  note_body text not null,
  source_url text,
  source_domain text,
  project_id uuid references public.note_projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint notes_note_body_len check (char_length(note_body) between 1 and 50000),
  constraint notes_title_len check (title is null or char_length(trim(title)) <= 200)
);

create index if not exists notes_user_id_created_at_idx
  on public.notes (user_id, created_at desc);

create index if not exists notes_user_id_updated_at_idx
  on public.notes (user_id, updated_at desc);

create index if not exists notes_user_id_project_id_idx
  on public.notes (user_id, project_id);

create index if not exists notes_user_id_source_domain_idx
  on public.notes (user_id, source_domain);

create table if not exists public.note_note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.note_tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

create index if not exists note_note_tags_user_id_tag_id_idx
  on public.note_note_tags (user_id, tag_id);

create index if not exists note_note_tags_user_id_note_id_idx
  on public.note_note_tags (user_id, note_id);

create or replace function public.set_notes_entity_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_note_projects_updated_at on public.note_projects;
create trigger trg_note_projects_updated_at
before update on public.note_projects
for each row
execute function public.set_notes_entity_updated_at();

drop trigger if exists trg_note_tags_updated_at on public.note_tags;
create trigger trg_note_tags_updated_at
before update on public.note_tags
for each row
execute function public.set_notes_entity_updated_at();

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
before update on public.notes
for each row
execute function public.set_notes_entity_updated_at();

alter table public.note_projects enable row level security;
alter table public.note_tags enable row level security;
alter table public.notes enable row level security;
alter table public.note_note_tags enable row level security;

-- Projects policies
drop policy if exists "note_projects_select_own" on public.note_projects;
create policy "note_projects_select_own"
on public.note_projects
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "note_projects_insert_own" on public.note_projects;
create policy "note_projects_insert_own"
on public.note_projects
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "note_projects_update_own" on public.note_projects;
create policy "note_projects_update_own"
on public.note_projects
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "note_projects_delete_own" on public.note_projects;
create policy "note_projects_delete_own"
on public.note_projects
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Tags policies
drop policy if exists "note_tags_select_own" on public.note_tags;
create policy "note_tags_select_own"
on public.note_tags
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "note_tags_insert_own" on public.note_tags;
create policy "note_tags_insert_own"
on public.note_tags
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "note_tags_update_own" on public.note_tags;
create policy "note_tags_update_own"
on public.note_tags
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "note_tags_delete_own" on public.note_tags;
create policy "note_tags_delete_own"
on public.note_tags
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Notes policies
drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own"
on public.notes
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own"
on public.notes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own"
on public.notes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "notes_delete_own" on public.notes;
create policy "notes_delete_own"
on public.notes
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Note-tag join policies
drop policy if exists "note_note_tags_select_own" on public.note_note_tags;
create policy "note_note_tags_select_own"
on public.note_note_tags
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "note_note_tags_insert_own" on public.note_note_tags;
create policy "note_note_tags_insert_own"
on public.note_note_tags
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "note_note_tags_delete_own" on public.note_note_tags;
create policy "note_note_tags_delete_own"
on public.note_note_tags
for delete
to authenticated
using ((select auth.uid()) = user_id);
