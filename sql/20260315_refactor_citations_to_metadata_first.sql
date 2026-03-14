create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  title text not null,
  source_type text not null default 'webpage',
  authors jsonb not null default '[]'::jsonb,
  container_title text null,
  publisher text null,
  issued_date jsonb not null default '{}'::jsonb,
  identifiers jsonb not null default '{}'::jsonb,
  canonical_url text null,
  page_url text null,
  metadata jsonb not null default '{}'::jsonb,
  raw_extraction jsonb not null default '{}'::jsonb,
  normalization_version integer not null default 1,
  source_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sources_source_type_idx
  on public.sources (source_type);

create index if not exists sources_canonical_url_idx
  on public.sources (canonical_url);

create table if not exists public.citation_instances (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid null references public.documents(id) on delete set null,
  legacy_citation_id text null,
  locator jsonb not null default '{}'::jsonb,
  quote_text text null,
  excerpt text null,
  annotation text null,
  citation_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists citation_instances_user_id_created_at_idx
  on public.citation_instances (user_id, created_at desc);

create index if not exists citation_instances_source_id_idx
  on public.citation_instances (source_id);

create unique index if not exists citation_instances_legacy_citation_id_idx
  on public.citation_instances (legacy_citation_id)
  where legacy_citation_id is not null;

create table if not exists public.citation_renders (
  id uuid primary key default gen_random_uuid(),
  citation_instance_id uuid not null references public.citation_instances(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  style text not null,
  render_kind text not null,
  rendered_text text not null,
  cache_key text not null unique,
  source_version text not null,
  citation_version text not null,
  render_version integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists citation_renders_instance_style_kind_idx
  on public.citation_renders (citation_instance_id, style, render_kind);

insert into public.sources (
  fingerprint,
  title,
  source_type,
  authors,
  container_title,
  publisher,
  issued_date,
  identifiers,
  canonical_url,
  page_url,
  metadata,
  raw_extraction,
  normalization_version,
  source_version
)
select distinct
  coalesce(nullif(c.metadata->>'source_fingerprint', ''), 'legacy:' || c.id::text) as fingerprint,
  coalesce(nullif(c.metadata->>'title', ''), nullif(c.metadata->>'headline', ''), 'Untitled Page') as title,
  coalesce(nullif(c.metadata->>'source_type', ''), 'webpage') as source_type,
  case
    when jsonb_typeof(c.metadata->'authors') = 'array' then c.metadata->'authors'
    else '[]'::jsonb
  end as authors,
  coalesce(nullif(c.metadata->>'container_title', ''), nullif(c.metadata->>'journalTitle', ''), nullif(c.metadata->>'siteName', '')) as container_title,
  coalesce(nullif(c.metadata->>'publisher', ''), nullif(c.metadata->>'siteName', '')) as publisher,
  jsonb_build_object(
    'raw', coalesce(c.metadata->>'datePublished', c.metadata->>'date', c.metadata->>'year'),
    'year', nullif(regexp_replace(coalesce(c.metadata->>'datePublished', c.metadata->>'date', c.metadata->>'year', ''), '^.*?((19|20)[0-9]{2}).*$', '\1'), coalesce(c.metadata->>'datePublished', c.metadata->>'date', c.metadata->>'year', ''))
  ) as issued_date,
  jsonb_strip_nulls(jsonb_build_object(
    'doi', coalesce(c.metadata->>'doi', c.metadata->>'DOI'),
    'isbn', c.metadata->>'isbn'
  )) as identifiers,
  nullif(coalesce(c.metadata->>'canonical_url', c.metadata->>'url', c.url), '') as canonical_url,
  nullif(coalesce(c.metadata->>'page_url', c.metadata->>'url', c.url), '') as page_url,
  coalesce(c.metadata, '{}'::jsonb) as metadata,
  jsonb_build_object(
    'legacy_table', 'citations',
    'legacy_citation_id', c.id,
    'legacy_row', to_jsonb(c)
  ) as raw_extraction,
  1 as normalization_version,
  coalesce(nullif(c.metadata->>'source_version', ''), md5(coalesce(c.metadata::text, c.url, c.id::text))) as source_version
from public.citations c
on conflict (fingerprint) do update
set
  updated_at = now(),
  metadata = excluded.metadata,
  raw_extraction = excluded.raw_extraction,
  source_version = excluded.source_version;

insert into public.citation_instances (
  id,
  source_id,
  user_id,
  legacy_citation_id,
  locator,
  quote_text,
  excerpt,
  annotation,
  citation_version,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  s.id,
  c.user_id,
  c.id::text,
  coalesce(c.metadata->'locator', '{}'::jsonb),
  nullif(coalesce(c.metadata->>'quote', c.excerpt), ''),
  c.excerpt,
  nullif(c.metadata->>'annotation', ''),
  md5(
    coalesce(c.excerpt, '') || '|' ||
    coalesce(c.metadata->>'quote', '') || '|' ||
    coalesce(c.metadata->>'annotation', '') || '|' ||
    coalesce((c.metadata->'locator')::text, '')
  ) as citation_version,
  coalesce(c.cited_at, now()),
  coalesce(c.cited_at, now())
from public.citations c
join public.sources s
  on s.fingerprint = coalesce(nullif(c.metadata->>'source_fingerprint', ''), 'legacy:' || c.id::text)
where not exists (
  select 1
  from public.citation_instances ci
  where ci.legacy_citation_id = c.id::text
);
