-- Research workspace extensions for notes
-- Add richer source metadata, optional citation linkage, full-text search, and stronger ownership checks.

alter table public.notes
  add column if not exists source_title text,
  add column if not exists source_author text,
  add column if not exists source_published_at timestamptz,
  add column if not exists citation_id uuid,
  add column if not exists search_vector tsvector;

alter table public.notes
  drop constraint if exists notes_source_title_len,
  add constraint notes_source_title_len check (source_title is null or char_length(trim(source_title)) <= 400),
  drop constraint if exists notes_source_author_len,
  add constraint notes_source_author_len check (source_author is null or char_length(trim(source_author)) <= 300);

-- Link notes to citations without duplicating citation metadata.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notes_citation_id_fkey'
      and conrelid = 'public.notes'::regclass
  ) then
    alter table public.notes
      add constraint notes_citation_id_fkey
      foreign key (citation_id)
      references public.citations(id)
      on delete set null;
  end if;
end
$$;

create index if not exists notes_user_id_project_id_created_at_idx
  on public.notes (user_id, project_id, created_at desc);

create index if not exists notes_user_id_source_domain_created_at_idx
  on public.notes (user_id, source_domain, created_at desc);

create index if not exists notes_user_id_archived_at_idx
  on public.notes (user_id, archived_at);

create index if not exists notes_user_id_citation_id_idx
  on public.notes (user_id, citation_id)
  where citation_id is not null;

create index if not exists notes_search_vector_idx
  on public.notes using gin (search_vector);

create or replace function public.update_notes_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.highlight_text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.note_body, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.source_title, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.source_domain, '')), 'D');
  return new;
end;
$$;

drop trigger if exists trg_notes_search_vector on public.notes;
create trigger trg_notes_search_vector
before insert or update of title, highlight_text, note_body, source_title, source_domain
on public.notes
for each row
execute function public.update_notes_search_vector();

update public.notes
set search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(highlight_text, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(note_body, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(source_title, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(source_domain, '')), 'D')
where search_vector is null;

-- Enforce project/citation ownership at policy level to prevent cross-user references.
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
      from public.citations c
      where c.id = citation_id
        and c.user_id = user_id
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
      from public.citations c
      where c.id = citation_id
        and c.user_id = user_id
    )
  )
);
