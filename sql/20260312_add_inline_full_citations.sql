alter table public.citations
  add column if not exists inline_citation text null,
  add column if not exists full_citation text null;

update public.citations
set inline_citation = coalesce(inline_citation, ''),
    full_citation = coalesce(full_citation, full_text)
where inline_citation is null
   or full_citation is null;

create index if not exists citations_user_id_format_cited_at_idx
  on public.citations (user_id, format, cited_at desc);
