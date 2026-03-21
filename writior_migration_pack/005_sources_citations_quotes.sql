begin;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  source_type text not null default 'webpage'
    check (source_type in ('webpage', 'article', 'book', 'journal', 'video', 'report', 'other')),
  title text not null,
  authors jsonb not null default '[]'::jsonb,
  container_title text,
  publisher text,
  issued_date jsonb not null default '{}'::jsonb,
  identifiers jsonb not null default '{}'::jsonb,
  canonical_url text,
  page_url text,
  hostname text,
  language_code text,
  metadata jsonb not null default '{}'::jsonb,
  raw_extraction jsonb not null default '{}'::jsonb,
  normalization_version integer not null default 1 check (normalization_version >= 1),
  source_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sources_hostname on public.sources(hostname);
create index if not exists idx_sources_source_type on public.sources(source_type);

create table if not exists public.citation_instances (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  locator jsonb not null default '{}'::jsonb,
  quote_text text,
  excerpt text,
  annotation text,
  citation_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_citation_instances_user_created_at
  on public.citation_instances(user_id, created_at desc);

create index if not exists idx_citation_instances_user_source
  on public.citation_instances(user_id, source_id);

create table if not exists public.citation_renders (
  id uuid primary key default gen_random_uuid(),
  citation_instance_id uuid not null references public.citation_instances(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  style text not null check (style in ('apa', 'mla', 'chicago', 'harvard', 'custom')),
  render_kind text not null check (render_kind in ('inline', 'full', 'bibliography')),
  rendered_text text not null,
  cache_key text not null unique,
  source_version text not null,
  citation_version text not null,
  render_version integer not null default 1 check (render_version >= 1),
  created_at timestamptz not null default now()
);

create index if not exists idx_citation_renders_instance_style_kind
  on public.citation_renders(citation_instance_id, style, render_kind);

create table if not exists public.citation_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  template_body text not null check (char_length(trim(template_body)) >= 1),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_citation_templates_user_name_ci
  on public.citation_templates(user_id, lower(name));

create unique index if not exists uq_citation_templates_one_default
  on public.citation_templates(user_id)
  where is_default = true;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  citation_id uuid not null references public.citation_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  excerpt text not null check (char_length(trim(excerpt)) between 1 and 50000),
  locator jsonb not null default '{}'::jsonb,
  annotation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quotes_citation_created_at
  on public.quotes(citation_id, created_at desc);

create index if not exists idx_quotes_user_created_at
  on public.quotes(user_id, created_at desc);

create or replace function public.get_monthly_citation_breakdown(
  p_user_id uuid,
  p_month_start date,
  p_month_end date
)
returns table(style text, citation_count bigint)
language sql
security definer
set search_path = public
as $$
  -- Count citations that were attached to documents during the month.
  -- Each citation instance is bucketed by the canonical render styles available for that citation.
  with attached_citations as (
    select distinct dc.citation_id
    from public.document_citations dc
    where dc.user_id = p_user_id
      and dc.attached_at >= p_month_start::timestamptz
      and dc.attached_at < (p_month_end + interval '1 day')::timestamptz
  ),
  styled_citations as (
    select distinct ac.citation_id, cr.style
    from attached_citations ac
    join public.citation_instances ci
      on ci.id = ac.citation_id
     and ci.user_id = p_user_id
    join public.citation_renders cr
      on cr.citation_instance_id = ci.id
  )
  select style, count(*)::bigint as citation_count
  from styled_citations
  group by style
  order by citation_count desc, style asc;
$$;

commit;
