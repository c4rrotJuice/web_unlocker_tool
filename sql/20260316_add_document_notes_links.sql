create table if not exists public.document_notes (
  doc_id uuid not null references public.documents(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attached_at timestamptz not null default now(),
  primary key (doc_id, note_id)
);

create index if not exists document_notes_user_id_doc_id_attached_at_idx
  on public.document_notes (user_id, doc_id, attached_at desc);

create index if not exists document_notes_user_id_note_id_idx
  on public.document_notes (user_id, note_id);

alter table public.document_notes enable row level security;

drop policy if exists "document_notes_select_own" on public.document_notes;
create policy "document_notes_select_own"
on public.document_notes
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "document_notes_insert_own" on public.document_notes;
create policy "document_notes_insert_own"
on public.document_notes
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.documents d
    where d.id = doc_id and d.user_id = user_id
  )
  and exists (
    select 1 from public.notes n
    where n.id = note_id and n.user_id = user_id
  )
);

drop policy if exists "document_notes_delete_own" on public.document_notes;
create policy "document_notes_delete_own"
on public.document_notes
for delete
to authenticated
using ((select auth.uid()) = user_id);
