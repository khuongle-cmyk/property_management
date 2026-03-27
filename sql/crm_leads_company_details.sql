-- =====================================================================
-- Leads: Finnish / EU company registration & structured contact fields
-- Run after crm_leads_pipeline.sql
-- =====================================================================

alter table public.leads
  add column if not exists business_id text,
  add column if not exists vat_number text,
  add column if not exists company_type text,
  add column if not exists industry_sector text,
  add column if not exists company_size text,
  add column if not exists company_website text,
  add column if not exists billing_street text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_city text,
  add column if not exists billing_email text,
  add column if not exists e_invoice_address text,
  add column if not exists e_invoice_operator_code text,
  add column if not exists contact_first_name text,
  add column if not exists contact_last_name text,
  add column if not exists contact_title text,
  add column if not exists contact_direct_phone text;

alter table public.leads drop constraint if exists leads_company_type_check;
alter table public.leads
  add constraint leads_company_type_check check (
    company_type is null or company_type in ('oy', 'oyj', 'ky', 'ay', 'toiminimi', 'other')
  );

alter table public.leads drop constraint if exists leads_company_size_check;
alter table public.leads
  add constraint leads_company_size_check check (
    company_size is null or company_size in ('1-10', '11-50', '51-200', '200+')
  );

comment on column public.leads.business_id is 'Finnish Y-tunnus (e.g. 1234567-8); Finvoice / invoicing.';
comment on column public.leads.vat_number is 'ALV-numero (e.g. FI12345678).';
comment on column public.leads.e_invoice_address is 'Verkkolaskuosoite (e-invoice routing address).';
comment on column public.leads.e_invoice_operator_code is 'Verkkolaskuoperaattorin välittäjätunnus (Finvoice operator / intermediary).';
