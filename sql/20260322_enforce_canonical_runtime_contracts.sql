create or replace function public.raise_read_only_compatibility_view()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Compatibility view "%" is read-only.', tg_table_name
    using errcode = '55000';
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'note_tags'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'note_tag_links'
  ) then
    alter table public.note_tags rename to note_tag_links;
  end if;
end
$$;

create table if not exists public.note_tag_links (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, tag_id)
);

create index if not exists note_tag_links_user_id_tag_id_idx
  on public.note_tag_links (user_id, tag_id);

create index if not exists note_tag_links_user_id_note_id_idx
  on public.note_tag_links (user_id, note_id);

alter table public.note_tag_links enable row level security;

drop policy if exists "note_tags_select_own" on public.note_tag_links;
drop policy if exists "note_tags_insert_own" on public.note_tag_links;
drop policy if exists "note_tags_delete_own" on public.note_tag_links;
drop policy if exists "note_tag_links_select_own" on public.note_tag_links;
create policy "note_tag_links_select_own"
on public.note_tag_links
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "note_tag_links_insert_own" on public.note_tag_links;
create policy "note_tag_links_insert_own"
on public.note_tag_links
for insert to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1 from public.notes n
    where n.id = note_tag_links.note_id and n.user_id = note_tag_links.user_id
  )
  and exists (
    select 1 from public.tags t
    where t.id = note_tag_links.tag_id and t.user_id = note_tag_links.user_id
  )
);

drop policy if exists "note_tag_links_delete_own" on public.note_tag_links;
create policy "note_tag_links_delete_own"
on public.note_tag_links
for delete to authenticated
using (auth.uid() = user_id);

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

drop view if exists public.note_tags;
create view public.note_tags as
select
  id,
  user_id,
  name,
  created_at,
  updated_at
from public.tags;

drop view if exists public.note_note_tags;
create view public.note_note_tags as
select
  note_id,
  tag_id,
  user_id,
  created_at
from public.note_tag_links;

drop view if exists public.note_tags_legacy;
create view public.note_tags_legacy as
select
  id,
  user_id,
  name,
  created_at,
  updated_at
from public.tags;

drop trigger if exists note_projects_read_only on public.note_projects;
create trigger note_projects_read_only
instead of insert or update or delete on public.note_projects
for each row execute function public.raise_read_only_compatibility_view();

drop trigger if exists note_tags_read_only on public.note_tags;
create trigger note_tags_read_only
instead of insert or update or delete on public.note_tags
for each row execute function public.raise_read_only_compatibility_view();

drop trigger if exists note_note_tags_read_only on public.note_note_tags;
create trigger note_note_tags_read_only
instead of insert or update or delete on public.note_note_tags
for each row execute function public.raise_read_only_compatibility_view();

drop trigger if exists note_tags_legacy_read_only on public.note_tags_legacy;
create trigger note_tags_legacy_read_only
instead of insert or update or delete on public.note_tags_legacy
for each row execute function public.raise_read_only_compatibility_view();
