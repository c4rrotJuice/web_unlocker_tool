alter table if exists public.documents
  add column if not exists content_html text;

create table if not exists public.doc_checkpoints (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null,
  content_delta jsonb not null,
  content_html text,
  created_at timestamptz not null default now()
);

create index if not exists doc_checkpoints_doc_id_idx on public.doc_checkpoints (doc_id, created_at desc);
create index if not exists doc_checkpoints_user_id_idx on public.doc_checkpoints (user_id);

alter table public.doc_checkpoints enable row level security;

create policy "Users can view their checkpoints"
  on public.doc_checkpoints
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their checkpoints"
  on public.doc_checkpoints
  for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their checkpoints"
  on public.doc_checkpoints
  for delete
  using (auth.uid() = user_id);
