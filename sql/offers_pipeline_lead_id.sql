-- =============================================================================
-- Offers: explicit CRM pipeline link (public.leads — same table as CRM module)
-- =============================================================================
-- The app historically used company_id → leads(id). This adds pipeline_lead_id as
-- an explicit synonym for reporting/integrations; both are kept in sync in the UI.
-- =============================================================================

alter table public.offers
  add column if not exists pipeline_lead_id uuid references public.leads (id) on delete set null;

update public.offers
set pipeline_lead_id = coalesce(pipeline_lead_id, company_id)
where pipeline_lead_id is null and company_id is not null;

create index if not exists offers_pipeline_lead_id_idx on public.offers (pipeline_lead_id);

-- PostgREST schema cache (if applicable)
-- notify pgrst, 'reload schema';
