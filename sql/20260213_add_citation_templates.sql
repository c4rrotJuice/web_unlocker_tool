create table if not exists public.citation_templates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    name text not null,
    template text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists citation_templates_user_id_idx on public.citation_templates (user_id);

alter table public.citation_templates enable row level security;

create policy "Users can view their citation templates"
    on public.citation_templates
    for select
    using (auth.uid() = user_id);

create policy "Users can insert their citation templates"
    on public.citation_templates
    for insert
    with check (auth.uid() = user_id);

create policy "Users can update their citation templates"
    on public.citation_templates
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their citation templates"
    on public.citation_templates
    for delete
    using (auth.uid() = user_id);
