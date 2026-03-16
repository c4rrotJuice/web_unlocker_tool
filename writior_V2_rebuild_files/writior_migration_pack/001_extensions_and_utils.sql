begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.normalize_trimmed_text(input_text text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(trim(coalesce(input_text, '')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.notes_search_document(
  p_title text,
  p_note_body text,
  p_highlight_text text,
  p_source_title text,
  p_source_author text
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('simple', coalesce(p_title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(p_note_body, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(p_highlight_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(p_source_title, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(p_source_author, '')), 'D');
$$;

create or replace function public.notes_search_vector_refresh()
returns trigger
language plpgsql
as $$
begin
  new.search_vector := public.notes_search_document(
    new.title,
    new.note_body,
    new.highlight_text,
    new.source_title,
    new.source_author
  );
  return new;
end;
$$;

commit;
