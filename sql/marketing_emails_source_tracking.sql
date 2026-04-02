-- Shared email provenance: marketing_emails is the single log for all ERP email sends.
ALTER TABLE public.marketing_emails ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'marketing';
ALTER TABLE public.marketing_emails ADD COLUMN IF NOT EXISTS related_id UUID;
ALTER TABLE public.marketing_emails ADD COLUMN IF NOT EXISTS related_type TEXT;

CREATE INDEX IF NOT EXISTS marketing_emails_source_idx ON public.marketing_emails (source);
CREATE INDEX IF NOT EXISTS marketing_emails_related_idx ON public.marketing_emails (related_type, related_id);

NOTIFY pgrst, 'reload schema';
