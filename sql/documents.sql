create table if not exists public.documents (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    title text not null default 'Untitled',
    content_delta jsonb not null default '{}'::jsonb,
    citation_ids uuid[] not null default '{}'::uuid[],
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    expires_at timestamptz null
);

create index if not exists documents_user_id_idx on public.documents (user_id);
create index if not exists documents_updated_at_idx on public.documents (updated_at desc);
create index if not exists documents_expires_at_idx on public.documents (expires_at);

alter table public.documents enable row level security;

create policy "Users can view their documents"
    on public.documents
    for select
    using (auth.uid() = user_id);

create policy "Users can insert their documents"
    on public.documents
    for insert
    with check (auth.uid() = user_id);

create policy "Users can update their documents"
    on public.documents
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their documents"
    on public.documents
    for delete
    using (auth.uid() = user_id);
