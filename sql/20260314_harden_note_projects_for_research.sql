-- Harden note_projects so it can serve as the root research container.
-- Additive and backward-compatible: no destructive changes.

alter table public.note_projects
  add column if not exists description text,
  add column if not exists status text not null default 'active',
  add column if not exists icon text,
  add column if not exists last_opened_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Ownership-safe composite key target for future (project_id, user_id) foreign keys.
create unique index if not exists note_projects_id_user_id_key
  on public.note_projects (id, user_id);

-- Keep status constrained for predictable filtering and RLS checks.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'note_projects_status_check'
      and conrelid = 'public.note_projects'::regclass
  ) then
    alter table public.note_projects
      add constraint note_projects_status_check
      check (status in ('active', 'archived'));
  end if;
end
$$;

-- Optional lightweight validation: keep icon concise (emoji or short token).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'note_projects_icon_len_check'
      and conrelid = 'public.note_projects'::regclass
  ) then
    alter table public.note_projects
      add constraint note_projects_icon_len_check
      check (icon is null or char_length(trim(icon)) between 1 and 32);
  end if;
end
$$;

-- Useful for user project list pages and archive filters.
create index if not exists note_projects_user_id_status_updated_at_idx
  on public.note_projects (user_id, status, updated_at desc);

-- Useful for recency UX ("recently opened").
create index if not exists note_projects_user_id_last_opened_at_idx
  on public.note_projects (user_id, last_opened_at desc nulls last);

-- Useful for archive list screens.
create index if not exists note_projects_user_id_archived_at_idx
  on public.note_projects (user_id, archived_at desc)
  where archived_at is not null;

-- Keep archived_at in sync when status flips to archived and vice versa.
create or replace function public.sync_note_project_archive_fields()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'archived' and new.archived_at is null then
    new.archived_at = now();
  elsif new.status = 'active' then
    new.archived_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_note_projects_archive_fields on public.note_projects;
create trigger trg_note_projects_archive_fields
before insert or update on public.note_projects
for each row
execute function public.sync_note_project_archive_fields();
