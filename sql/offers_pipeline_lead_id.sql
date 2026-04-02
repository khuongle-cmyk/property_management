-- =============================================================================
-- Offers: explicit CRM pipeline link (public.leads — same table as CRM module)
-- =============================================================================
-- The app historically used company_id → leads(id). This adds lead_id as
-- an explicit link for reporting/integrations; company_id may still be set from the UI.
-- =============================================================================

alter table public.offers
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

update public.offers
set lead_id = coalesce(lead_id, company_id)
where lead_id is null and company_id is not null;

create index if not exists offers_lead_id_idx on public.offers (lead_id);

-- PostgREST schema cache (if applicable)
-- notify pgrst, 'reload schema';
