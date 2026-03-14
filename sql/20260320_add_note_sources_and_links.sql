-- Phase 5: attach multiple sources and interlink notes

create table if not exists public.note_sources (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  title text,
  hostname text,
  attached_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists note_sources_note_id_url_key
  on public.note_sources (note_id, lower(url));

create index if not exists note_sources_user_id_note_id_idx
  on public.note_sources (user_id, note_id);

create table if not exists public.note_links (
  note_id uuid not null references public.notes(id) on delete cascade,
  linked_note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, linked_note_id),
  constraint note_links_no_self_link check (note_id <> linked_note_id)
);

create index if not exists note_links_user_id_note_id_idx
  on public.note_links (user_id, note_id);

create index if not exists note_links_user_id_linked_note_id_idx
  on public.note_links (user_id, linked_note_id);

alter table public.note_sources enable row level security;
alter table public.note_links enable row level security;

drop policy if exists "note_sources_select_own" on public.note_sources;
create policy "note_sources_select_own"
on public.note_sources
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "note_sources_insert_own" on public.note_sources;
create policy "note_sources_insert_own"
on public.note_sources
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "note_sources_delete_own" on public.note_sources;
create policy "note_sources_delete_own"
on public.note_sources
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "note_links_select_own" on public.note_links;
create policy "note_links_select_own"
on public.note_links
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "note_links_insert_own" on public.note_links;
create policy "note_links_insert_own"
on public.note_links
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.notes n
    where n.id = note_id and n.user_id = user_id
  )
  and exists (
    select 1 from public.notes n2
    where n2.id = linked_note_id and n2.user_id = user_id
  )
);

drop policy if exists "note_links_delete_own" on public.note_links;
create policy "note_links_delete_own"
on public.note_links
for delete
to authenticated
using ((select auth.uid()) = user_id);
