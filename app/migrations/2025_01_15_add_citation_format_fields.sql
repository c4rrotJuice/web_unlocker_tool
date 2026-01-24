-- Add citation format metadata and retention fields.
ALTER TABLE public.citations
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS custom_format_name text,
  ADD COLUMN IF NOT EXISTS custom_format_template text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.citations
SET
  format = COALESCE(format, 'mla'),
  expires_at = COALESCE(expires_at, cited_at + interval '30 days')
WHERE format IS NULL OR expires_at IS NULL;

ALTER TABLE public.citations
  ALTER COLUMN format SET NOT NULL,
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.citations
  ADD CONSTRAINT citations_format_check
  CHECK (format IN ('mla', 'apa', 'chicago', 'harvard', 'custom'));

CREATE INDEX IF NOT EXISTS citations_user_id_idx ON public.citations(user_id);
CREATE INDEX IF NOT EXISTS citations_expires_at_idx ON public.citations(expires_at);
CREATE INDEX IF NOT EXISTS citations_format_idx ON public.citations(format);

CREATE OR REPLACE FUNCTION public.enforce_custom_format_fields()
RETURNS trigger AS $$
BEGIN
  IF NEW.format = 'custom' THEN
    IF NEW.custom_format_template IS NULL OR length(trim(NEW.custom_format_template)) = 0 THEN
      RAISE EXCEPTION 'custom_format_template required for custom format';
    END IF;
  ELSE
    IF NEW.custom_format_template IS NOT NULL THEN
      RAISE EXCEPTION 'custom_format_template only allowed for custom format';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS citations_custom_format_guard ON public.citations;

CREATE TRIGGER citations_custom_format_guard
BEFORE INSERT OR UPDATE ON public.citations
FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_format_fields();
