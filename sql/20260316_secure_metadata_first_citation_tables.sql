alter table public.sources enable row level security;
alter table public.citation_instances enable row level security;
alter table public.citation_renders enable row level security;

drop policy if exists "sources_select_linked_to_owned_citations" on public.sources;
create policy "sources_select_linked_to_owned_citations"
on public.sources
for select
to authenticated
using (
  exists (
    select 1
    from public.citation_instances ci
    where ci.source_id = public.sources.id
      and ci.user_id = auth.uid()
  )
);

drop policy if exists "citation_instances_select_own" on public.citation_instances;
create policy "citation_instances_select_own"
on public.citation_instances
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "citation_instances_insert_own" on public.citation_instances;
create policy "citation_instances_insert_own"
on public.citation_instances
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "citation_instances_update_own" on public.citation_instances;
create policy "citation_instances_update_own"
on public.citation_instances
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "citation_instances_delete_own" on public.citation_instances;
create policy "citation_instances_delete_own"
on public.citation_instances
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "citation_renders_select_owned_instances" on public.citation_renders;
create policy "citation_renders_select_owned_instances"
on public.citation_renders
for select
to authenticated
using (
  exists (
    select 1
    from public.citation_instances ci
    where ci.id = public.citation_renders.citation_instance_id
      and ci.user_id = auth.uid()
  )
);

drop policy if exists "citation_renders_insert_owned_instances" on public.citation_renders;
create policy "citation_renders_insert_owned_instances"
on public.citation_renders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.citation_instances ci
    where ci.id = public.citation_renders.citation_instance_id
      and ci.user_id = auth.uid()
  )
);

drop policy if exists "citation_renders_delete_owned_instances" on public.citation_renders;
create policy "citation_renders_delete_owned_instances"
on public.citation_renders
for delete
to authenticated
using (
  exists (
    select 1
    from public.citation_instances ci
    where ci.id = public.citation_renders.citation_instance_id
      and ci.user_id = auth.uid()
  )
);

-- Clean stale notes.citation_id values before adding FK
update public.notes n
set citation_id = null
where n.citation_id is not null
  and not exists (
    select 1
    from public.citation_instances ci
    where ci.id = n.citation_id
  );

alter table public.notes
  drop constraint if exists notes_citation_id_fkey;

alter table public.notes
  add constraint notes_citation_id_fkey
  foreign key (citation_id)
  references public.citation_instances(id)
  on delete set null;

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own"
on public.notes
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    project_id is null
    or exists (
      select 1
      from public.note_projects p
      where p.id = project_id
        and p.user_id = user_id
    )
  )
  and (
    citation_id is null
    or exists (
      select 1
      from public.citation_instances ci
      where ci.id = citation_id
        and ci.user_id = user_id
    )
  )
);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own"
on public.notes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    project_id is null
    or exists (
      select 1
      from public.note_projects p
      where p.id = project_id
        and p.user_id = user_id
    )
  )
  and (
    citation_id is null
    or exists (
      select 1
      from public.citation_instances ci
      where ci.id = citation_id
        and ci.user_id = user_id
    )
  )
);
