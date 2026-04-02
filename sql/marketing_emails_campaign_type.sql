-- Kind of marketing email (not the FK to marketing_campaigns).
-- Use campaign_id only when linking to public.marketing_campaigns (UUID); otherwise NULL.
ALTER TABLE public.marketing_emails ADD COLUMN IF NOT EXISTS campaign_type TEXT;

CREATE INDEX IF NOT EXISTS marketing_emails_campaign_type_idx ON public.marketing_emails (campaign_type);

NOTIFY pgrst, 'reload schema';
