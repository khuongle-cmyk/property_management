-- =============================================================================
-- Contract tool: offers versioning + tool contracts (CRM company = public.leads)
-- =============================================================================
-- CRM companies/contacts in this codebase live in public.leads:
--   id            uuid PK
--   company_name  text NOT NULL
-- FK targets leads(id), not a separate companies table.
-- =============================================================================

-- ---- Offers (tenant commercial offers; table may be renamed from proposals) ----
alter table public.offers
  add column if not exists company_id uuid references public.leads (id) on delete set null,
  add column if not exists version integer not null default 1,
  add column if not exists parent_offer_id uuid references public.offers (id) on delete set null;

create index if not exists offers_company_id_idx on public.offers (company_id);
create index if not exists offers_parent_offer_id_idx on public.offers (parent_offer_id);

-- ---- Contract tool legal contracts (separate from room_contracts / leases) ----
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid (),
  company_id uuid references public.leads (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  source_offer_id uuid references public.offers (id) on delete set null,
  title text,
  status text not null default 'draft',
  signing_method text not null default 'esign',
  paper_document_url text,
  version integer not null default 1,
  parent_contract_id uuid references public.contracts (id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  customer_company text,
  property_id uuid references public.properties (id) on delete set null,
  space_details text,
  monthly_price numeric(12, 2),
  contract_length_months integer,
  start_date date,
  intro_text text,
  terms_text text,
  notes text,
  is_template boolean not null default false,
  template_name text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_status_check check (
    status in ('draft', 'sent', 'signed_digital', 'signed_paper', 'active')
  ),
  constraint contracts_signing_method_check check (signing_method in ('esign', 'paper'))
);

create index if not exists contracts_company_id_idx on public.contracts (company_id);
create index if not exists contracts_parent_contract_id_idx on public.contracts (parent_contract_id);
create index if not exists contracts_source_offer_id_idx on public.contracts (source_offer_id);
create index if not exists contracts_created_at_idx on public.contracts (created_at desc);

alter table public.contracts enable row level security;

-- Adjust policies to match your tenant model (example: all authenticated staff).
drop policy if exists contracts_all_authenticated on public.contracts;
create policy contracts_all_authenticated on public.contracts
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
