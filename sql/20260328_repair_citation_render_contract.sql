update public.citation_renders
set render_kind = 'bibliography'
where render_kind = 'full';

alter table public.citation_renders
  drop constraint if exists citation_renders_render_kind_check;

alter table public.citation_renders
  add constraint citation_renders_render_kind_check
  check (render_kind in ('inline', 'bibliography', 'footnote', 'quote_attribution'));
